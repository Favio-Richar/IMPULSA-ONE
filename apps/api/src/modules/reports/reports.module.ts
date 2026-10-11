import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

// El informe se arma sobre la analítica agregada (F3.7) y su límite de historial por plan (F4.3).
@Module({
  imports: [AnalyticsModule, PlansModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
