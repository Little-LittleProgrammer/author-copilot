import { Controller, Get } from "@nestjs/common";

export interface HealthResponse {
  service: "author-copilot-api";
  status: "ok";
  timestamp: string;
  version: string;
}

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      service: "author-copilot-api",
      status: "ok",
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION ?? "0.0.0",
    };
  }
}
