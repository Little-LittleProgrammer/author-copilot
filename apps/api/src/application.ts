import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

interface ExpressLikeApplication {
  disable(setting: string): void;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function configureCors(app: INestApplication): void {
  if (process.env.CORS_ENABLED !== "true") {
    return;
  }

  const origins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error("CORS_ORIGINS is required when CORS_ENABLED=true");
  }

  app.enableCors({
    credentials: true,
    methods: ["GET", "POST"],
    origin: origins,
  });
}

export async function createApplication(): Promise<INestApplication> {
  const options =
    process.env.NODE_ENV === "test" ? { logger: false as const } : {};
  const app = await NestFactory.create(AppModule, options);

  const express = app.getHttpAdapter().getInstance() as ExpressLikeApplication;
  express.disable("x-powered-by");

  app.use((_request: unknown, response: HeaderResponse, next: () => void) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.setHeader(name, value);
    }
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  configureCors(app);

  return app;
}
