import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { HttpException } from "@nestjs/common";
import { SignJWT, jwtVerify } from "jose";
import nodemailer from "nodemailer";
import type { AccountUser, SessionTokens } from "@author-copilot/contracts";
import type { PlatformDatabase } from "./database.js";

const scrypt = promisify(scryptCallback);
export const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
interface User {
  _id: string;
  email: string;
  passwordHash: string;
}
interface Session {
  _id: string;
  userId: string;
  refreshHash: string;
  previousHashes: string[];
  revoked: boolean;
  expiresAt: Date;
}
interface Reset {
  _id: string;
  userId: string;
  expiresAt: Date;
}
interface Grant {
  _id: string;
  userId: string;
  sessionId: string;
  taskId: string;
  model: string;
  expiresAt: Date;
  revoked: boolean;
}
export interface Principal {
  userId: string;
  sessionId: string;
  model?: string;
  taskId?: string;
}
export interface ResetMailer {
  send(email: string, token: string): Promise<void>;
}
export class SmtpResetMailer implements ResetMailer {
  async send(email: string, token: string): Promise<void> {
    if (!process.env.SMTP_URL || !process.env.SMTP_FROM)
      throw new HttpException("Password reset email is unavailable.", 503);
    await nodemailer.createTransport(process.env.SMTP_URL).sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: "Author Copilot password reset",
      text: `Enter this one-time code in Author Copilot within 20 minutes:\n\n${token}\n\nIgnore this message if you did not request it.`,
    });
  }
}
export class AuthService {
  constructor(
    private readonly database: PlatformDatabase,
    private readonly mailer: ResetMailer = new SmtpResetMailer(),
  ) {}
  private secret(): Uint8Array {
    const secret = process.env.AUTH_SIGNING_SECRET;
    if (!secret || secret.length < 32)
      throw new HttpException("Account service is not configured.", 503);
    return new TextEncoder().encode(secret);
  }
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const key = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${key.toString("hex")}`;
  }
  async register(email: string, password: string): Promise<SessionTokens> {
    this.secret();
    const user: User = {
      _id: randomUUID(),
      email,
      passwordHash: await this.hash(password),
    };
    try {
      await this.database.transaction(async (database, session) => {
        await database.collection<User>("users").insertOne(user, { session });
        await database
          .collection<{
            _id: string;
            availableMicro: number;
            heldMicro: number;
          }>("wallets")
          .insertOne(
            { _id: user._id, availableMicro: 0, heldMicro: 0 },
            { session },
          );
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
      )
        throw new HttpException(
          "Account could not be created with this email.",
          409,
        );
      throw error;
    }
    return this.createSession(user);
  }
  async login(email: string, password: string): Promise<SessionTokens> {
    const user = await (
      await this.database.db()
    )
      .collection<User>("users")
      .findOne({ email });
    const [salt, hex] = (
      user?.passwordHash ??
      "00000000000000000000000000000000:" + "0".repeat(128)
    ).split(":");
    const actual = (await scrypt(password, salt ?? "", 64)) as Buffer;
    if (!user || !hex || !timingSafeEqual(actual, Buffer.from(hex, "hex")))
      throw new HttpException("Invalid email or password.", 401);
    return this.createSession(user);
  }
  private async tokens(
    user: User,
    sessionId: string,
    refreshToken: string,
  ): Promise<SessionTokens> {
    const expiresAt = Math.floor(Date.now() / 1000) + 900;
    const accessToken = await new SignJWT({ sid: sessionId, kind: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user._id)
      .setIssuer("author-copilot")
      .setAudience("desktop")
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(this.secret());
    return {
      user: { id: user._id, email: user.email },
      accessToken,
      refreshToken,
      expiresAt,
    };
  }
  private async createSession(user: User): Promise<SessionTokens> {
    const sessionId = randomUUID();
    const token = `${sessionId}.${randomBytes(32).toString("hex")}`;
    await (await this.database.db()).collection<Session>("sessions").insertOne({
      _id: sessionId,
      userId: user._id,
      refreshHash: digest(token),
      previousHashes: [],
      revoked: false,
      expiresAt: new Date(Date.now() + 30 * 86400000),
    });
    return this.tokens(user, sessionId, token);
  }
  async refresh(token: string): Promise<SessionTokens> {
    const id = token.split(".")[0] ?? "";
    const sessions = (await this.database.db()).collection<Session>("sessions");
    const next = `${id}.${randomBytes(32).toString("hex")}`;
    const session = await sessions.findOneAndUpdate(
      {
        _id: id,
        refreshHash: digest(token),
        previousHashes: [],
        revoked: false,
        expiresAt: { $gt: new Date() },
      },
      {
        $set: { refreshHash: digest(next) },
        $push: { previousHashes: digest(token) },
      },
      { returnDocument: "after" },
    );
    if (!session) {
      // Reuse of a previously valid session token revokes that session family.
      await sessions.updateOne(
        { _id: id, previousHashes: digest(token) },
        { $set: { revoked: true } },
      );
      throw new HttpException("Session expired. Sign in again.", 401);
    }
    const user = await (
      await this.database.db()
    )
      .collection<User>("users")
      .findOne({ _id: session.userId });
    if (!user) throw new HttpException("Account unavailable.", 401);
    return this.tokens(user, id, next);
  }
  async authenticate(token: string, allowTask = false): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.secret(), {
        issuer: "author-copilot",
        audience: "desktop",
        algorithms: ["HS256"],
      });
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string")
        throw new Error("Invalid claims");
      const db = await this.database.db();
      const session = await db.collection<Session>("sessions").findOne({
        _id: payload.sid,
        userId: payload.sub,
        revoked: false,
        expiresAt: { $gt: new Date() },
      });
      if (!session) throw new Error("Session revoked");
      if (payload.kind === "access")
        return { userId: payload.sub, sessionId: payload.sid };
      if (
        !allowTask ||
        payload.kind !== "task" ||
        typeof payload.jti !== "string"
      )
        throw new Error("Invalid token kind");
      const grant = await db.collection<Grant>("grants").findOne({
        _id: payload.jti,
        userId: payload.sub,
        sessionId: payload.sid,
        revoked: false,
        expiresAt: { $gt: new Date() },
      });
      if (!grant) throw new Error("Task authorization expired");
      return {
        userId: grant.userId,
        sessionId: grant.sessionId,
        taskId: grant.taskId,
        model: grant.model,
      };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 503)
        throw error;
      throw new HttpException("Authentication required or expired.", 401);
    }
  }
  async user(principal: Principal): Promise<AccountUser> {
    const user = await (
      await this.database.db()
    )
      .collection<User>("users")
      .findOne({ _id: principal.userId });
    if (!user) throw new HttpException("Account unavailable.", 401);
    return { id: user._id, email: user.email };
  }
  async logout(principal: Principal, all = false): Promise<void> {
    await (
      await this.database.db()
    )
      .collection<Session>("sessions")
      .updateMany(
        all ? { userId: principal.userId } : { _id: principal.sessionId },
        { $set: { revoked: true } },
      );
  }
  async forgot(email: string): Promise<void> {
    const db = await this.database.db();
    const user = await db
      .collection<User>("users")
      .findOne({ email: email.toLowerCase() });
    if (!user) return;
    const token = randomBytes(32).toString("hex");
    await db.collection<Reset>("resets").insertOne({
      _id: digest(token),
      userId: user._id,
      expiresAt: new Date(Date.now() + 1200000),
    });
    try {
      await this.mailer.send(email, token);
    } catch (error) {
      await db.collection<Reset>("resets").deleteOne({ _id: digest(token) });
      throw error;
    }
  }
  async reset(token: string, password: string): Promise<void> {
    const passwordHash = await this.hash(password);
    await this.database.transaction(async (db, session) => {
      const reset = await db
        .collection<Reset>("resets")
        .findOneAndDelete(
          { _id: digest(token), expiresAt: { $gt: new Date() } },
          { session },
        );
      if (!reset)
        throw new HttpException("Reset code is invalid or expired.", 400);
      await db
        .collection<User>("users")
        .updateOne(
          { _id: reset.userId },
          { $set: { passwordHash } },
          { session },
        );
      await db
        .collection<Session>("sessions")
        .updateMany(
          { userId: reset.userId },
          { $set: { revoked: true } },
          { session },
        );
      await db
        .collection<Reset>("resets")
        .deleteMany({ userId: reset.userId }, { session });
    });
  }
  async grant(
    principal: Principal,
    taskId: string,
    model: string,
    durationMs: number,
  ): Promise<{ token: string; id: string }> {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + durationMs);
    await (await this.database.db()).collection<Grant>("grants").insertOne({
      _id: id,
      userId: principal.userId,
      sessionId: principal.sessionId,
      taskId,
      model,
      expiresAt,
      revoked: false,
    });
    const token = await new SignJWT({ sid: principal.sessionId, kind: "task" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(principal.userId)
      .setJti(id)
      .setIssuer("author-copilot")
      .setAudience("desktop")
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret());
    return { token, id };
  }
  async revoke(principal: Principal, id: string): Promise<void> {
    await (
      await this.database.db()
    )
      .collection<Grant>("grants")
      .updateOne(
        { _id: id, userId: principal.userId },
        { $set: { revoked: true } },
      );
  }
}
