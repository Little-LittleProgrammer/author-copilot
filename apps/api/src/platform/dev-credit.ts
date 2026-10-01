import { PlatformDatabase } from "./database.js";
import { BillingService } from "./billing-service.js";
const database = new PlatformDatabase();
try {
  const email = process.argv[2];
  const amountMicro = Number(process.argv[3]);
  if (!email)
    throw new Error(
      "Usage: NODE_ENV=development pnpm dev:credit <email> <integer-microyuan>",
    );
  await new BillingService(database).developmentCredit(email, amountMicro);
  process.stdout.write("Development credit initialized (idempotent).\n");
} finally {
  await database.onModuleDestroy();
}
