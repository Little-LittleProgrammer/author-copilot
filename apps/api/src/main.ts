import "reflect-metadata";

import { Logger } from "@nestjs/common";

import { createApplication } from "./application.js";

const DEFAULT_PORT = 9191;

function getPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  return port;
}

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const host = process.env.HOST ?? "0.0.0.0";
  const port = getPort(process.env.PORT);

  await app.listen(port, host);
  Logger.log(`API listening on http://${host}:${port}`, "Bootstrap");
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, undefined, "Bootstrap");
  process.exitCode = 1;
});
