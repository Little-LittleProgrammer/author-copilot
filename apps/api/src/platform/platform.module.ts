import { Module } from "@nestjs/common";
import { PlatformDatabase } from "./database.js";
import { AuthService } from "./auth-service.js";
import { BillingService } from "./billing-service.js";
import { RelayService } from "./relay-service.js";
import { PlatformController } from "./platform.controller.js";
@Module({
  controllers: [PlatformController],
  providers: [
    PlatformDatabase,
    {
      provide: AuthService,
      useFactory: (database: PlatformDatabase) => new AuthService(database),
      inject: [PlatformDatabase],
    },
    {
      provide: BillingService,
      useFactory: (database: PlatformDatabase) => new BillingService(database),
      inject: [PlatformDatabase],
    },
    {
      provide: RelayService,
      useFactory: (database: PlatformDatabase, billing: BillingService) =>
        new RelayService(database, billing),
      inject: [PlatformDatabase, BillingService],
    },
  ],
})
export class PlatformModule {}
