import { MongoClient, type Db, type ClientSession } from "mongodb";
import { createClient } from "redis";
import { HttpException } from "@nestjs/common";

export class PlatformDatabase {
  private client: MongoClient | undefined;
  private connecting: Promise<Db> | undefined;
  private redis: ReturnType<typeof createClient> | undefined;
  private redisConnecting: Promise<unknown> | undefined;
  async db(): Promise<Db> {
    if (!this.connecting) {
      this.connecting = this.connect().catch((error: unknown) => {
        this.connecting = undefined;
        throw error;
      });
    }
    return this.connecting;
  }
  private async connect(): Promise<Db> {
    this.client = new MongoClient(
      process.env.MONGODB_URI ??
        "mongodb://127.0.0.1:27017/author_copilot?replicaSet=rs0",
      { serverSelectionTimeoutMS: 5000 },
    );
    await this.client.connect();
    const db = this.client.db();
    await Promise.all([
      db.collection("users").createIndex({ email: 1 }, { unique: true }),
      db.collection("ledger").createIndex({ userId: 1, createdAt: -1 }),
      db
        .collection("resets")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    return db;
  }
  async transaction<T>(
    operation: (db: Db, session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const db = await this.db();
    if (!this.client) throw new Error("Database unavailable.");
    const session = this.client.startSession();
    try {
      return await session.withTransaction(() => operation(db, session));
    } finally {
      await session.endSession();
    }
  }
  async limit(key: string, maximum: number, seconds = 60): Promise<void> {
    if (!this.redis) {
      this.redis = createClient({
        url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
        socket: { reconnectStrategy: false, connectTimeout: 3000 },
      });
      this.redis.on("error", () => undefined);
    }
    if (!this.redis.isReady) {
      this.redisConnecting ??= this.redis.connect().finally(() => {
        this.redisConnecting = undefined;
      });
      await this.redisConnecting;
    }
    const count = Number(
      await this.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n",
        { keys: [`ac:limit:${key}`], arguments: [String(seconds)] },
      ),
    );
    if (count > maximum) throw new HttpException("Too many requests.", 429);
  }
  async onModuleDestroy(): Promise<void> {
    if (this.redis?.isOpen) this.redis.destroy();
    await this.client?.close();
  }
}
