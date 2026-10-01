import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { FunnelsController } from "./funnels.controller.js";
import { FunnelsService } from "./funnels.service.js";

@Module({
  // `AnalyticsReportsService`: el mismo límite de historial del plan que el resto de la analítica.
  imports: [AnalyticsModule],
  controllers: [FunnelsController],
  providers: [FunnelsService],
})
export class FunnelsModule {}
