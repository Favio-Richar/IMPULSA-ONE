import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { PublicAnalyticsController } from "./public-analytics.controller.js";

@Module({
  imports: [AnalyticsModule],
  controllers: [PublicAnalyticsController],
})
export class PublicAnalyticsModule {}
