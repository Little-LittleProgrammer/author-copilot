import { PlatformModule } from "./platform/platform.module.js";
import { Module } from "@nestjs/common";

import { HealthController } from "./health/health.controller.js";

@Module({
  imports: [PlatformModule],
  controllers: [HealthController],
})
export class AppModule {}
