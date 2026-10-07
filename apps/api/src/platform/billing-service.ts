import { HttpException } from "@nestjs/common";
import type { AccountSummary, ModelPrice } from "@author-copilot/contracts";
import type { PlatformDatabase } from "./database.js";

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
interface Wallet {
  _id: string;
  availableMicro: number;
  heldMicro: number;
}
interface Ledger {
  _id: string;
  userId: string;
  model: string;
  status: "reserved" | "settled" | "released" | "pending_review" | "credit";
  reservedMicro: number;
  chargedMicro: number;
  createdAt: string;
  price?: ModelPrice;
  inputTokens?: number;
  outputTokens?: number;
  dispatched?: boolean;
}
export function usageCost(usage: TokenUsage, price: ModelPrice): number {
  let sum = 0n;
  for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
    if (
      !Number.isSafeInteger(usage[key]) ||
      usage[key] < 0 ||
      !Number.isSafeInteger(price[key]) ||
      price[key] < 0
    )
      throw new Error("Invalid token accounting.");
    sum += BigInt(usage[key]) * BigInt(price[key]);
  }
  const result = Number((sum + 999999n) / 1000000n);
  if (!Number.isSafeInteger(result))
    throw new Error("Token cost exceeds supported range.");
  return result;
}
export class BillingService {
  constructor(private readonly database: PlatformDatabase) {}
  async reserve(
    userId: string,
    id: string,
    model: string,
    inputTokens: number,
    maxOutput: number,
    price: ModelPrice,
  ): Promise<void> {
    const upperPrice = {
      ...price,
      input: Math.max(price.input, price.cacheWrite, price.cacheRead),
    };
    const reservedMicro = usageCost(
      { input: inputTokens, output: maxOutput, cacheRead: 0, cacheWrite: 0 },
      upperPrice,
    );
    await this.database.transaction(async (db, session) => {
      if (
        await db.collection<Ledger>("ledger").findOne({ _id: id }, { session })
      )
        throw new HttpException("Request has already been submitted.", 409);
      const wallet = await db.collection<Wallet>("wallets").findOneAndUpdate(
        { _id: userId, availableMicro: { $gte: reservedMicro } },
        {
          $inc: { availableMicro: -reservedMicro, heldMicro: reservedMicro },
        },
        { session },
      );
      if (!wallet) throw new HttpException("Insufficient balance.", 402);
      await db.collection<Ledger>("ledger").insertOne(
        {
          _id: id,
          userId,
          model,
          status: "reserved",
          reservedMicro,
          chargedMicro: 0,
          createdAt: new Date().toISOString(),
          price,
        },
        { session },
      );
    });
  }
  async dispatched(id: string): Promise<void> {
    await (
      await this.database.db()
    )
      .collection<Ledger>("ledger")
      .updateOne(
        { _id: id, status: "reserved" },
        { $set: { dispatched: true } },
      );
  }
  async reconcileStale(): Promise<void> {
    const stale = await (
      await this.database.db()
    )
      .collection<Ledger>("ledger")
      .find({
        status: "reserved",
        createdAt: { $lt: new Date(Date.now() - 300000).toISOString() },
      })
      .limit(100)
      .toArray();
    for (const row of stale)
      await this.finish(
        row._id,
        row.dispatched ? "pending_review" : "released",
      );
  }
  async finish(
    id: string,
    outcome: TokenUsage | "released" | "pending_review",
  ): Promise<void> {
    await this.database.transaction(async (db, session) => {
      const ledger = db.collection<Ledger>("ledger");
      const row = await ledger.findOne(
        { _id: id, status: "reserved" },
        { session },
      );
      if (!row) return;
      if (outcome === "pending_review") {
        await ledger.updateOne(
          { _id: id },
          { $set: { status: "pending_review" } },
          { session },
        );
        return;
      }
      const chargedMicro =
        outcome === "released" ? 0 : usageCost(outcome, row.price!);
      if (chargedMicro > row.reservedMicro) {
        await ledger.updateOne(
          { _id: id },
          { $set: { status: "pending_review" } },
          { session },
        );
        return;
      }
      await db.collection<Wallet>("wallets").updateOne(
        { _id: row.userId },
        {
          $inc: {
            availableMicro: row.reservedMicro - chargedMicro,
            heldMicro: -row.reservedMicro,
          },
        },
        { session },
      );
      await ledger.updateOne(
        { _id: id },
        {
          $set: {
            status: outcome === "released" ? "released" : "settled",
            chargedMicro,
            ...(outcome === "released"
              ? {}
              : {
                  inputTokens:
                    outcome.input + outcome.cacheRead + outcome.cacheWrite,
                  outputTokens: outcome.output,
                }),
          },
        },
        { session },
      );
    });
  }
  async summary(userId: string): Promise<AccountSummary> {
    await this.reconcileStale();
    const db = await this.database.db();
    const wallet = await db
      .collection<Wallet>("wallets")
      .findOne({ _id: userId });
    const records = await db
      .collection<Ledger>("ledger")
      .find({ userId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(50)
      .toArray();
    return {
      availableMicro: wallet?.availableMicro ?? 0,
      heldMicro: wallet?.heldMicro ?? 0,
      paymentEnabled: false,
      records: records.map(
        ({
          _id,
          model,
          status,
          reservedMicro,
          chargedMicro,
          createdAt,
          inputTokens,
          outputTokens,
        }) => ({
          id: _id,
          model,
          status,
          reservedMicro,
          chargedMicro,
          createdAt,
          ...(inputTokens === undefined ? {} : { inputTokens }),
          ...(outputTokens === undefined ? {} : { outputTokens }),
        }),
      ),
    };
  }
  async developmentCredit(email: string, micro: number): Promise<void> {
    if (
      process.env.NODE_ENV !== "development" ||
      !Number.isSafeInteger(micro) ||
      micro <= 0 ||
      micro > 1e12
    )
      throw new Error("Test credit is only allowed explicitly in development.");
    await this.database.transaction(async (db, session) => {
      const user = await db
        .collection<{ _id: string; email: string }>("users")
        .findOne({ email: email.toLowerCase() }, { session });
      if (!user)
        throw new Error("Create the test account before assigning credit.");
      const id = `development-credit:${user._id}`;
      if (
        await db.collection<Ledger>("ledger").findOne({ _id: id }, { session })
      )
        return;
      await db
        .collection<Wallet>("wallets")
        .updateOne(
          { _id: user._id },
          { $inc: { availableMicro: micro } },
          { session },
        );
      await db.collection<Ledger>("ledger").insertOne(
        {
          _id: id,
          userId: user._id,
          model: "",
          status: "credit",
          reservedMicro: 0,
          chargedMicro: -micro,
          createdAt: new Date().toISOString(),
        },
        { session },
      );
    });
  }
}
