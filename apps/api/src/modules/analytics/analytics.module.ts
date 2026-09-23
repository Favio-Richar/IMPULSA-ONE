import { Module } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service.js";

@Module({
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
