import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { ReportSchedulesController } from "./report-schedule.controller.js";
import { ReportScheduleRunner } from "./report-schedule.runner.js";
import { ReportScheduleService } from "./report-schedule.service.js";
import { PublicReportsController, ReportShareLinksController } from "./report-share.controller.js";
import { ReportShareService } from "./report-share.service.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

// El informe se arma sobre la analítica agregada (F3.7) y su límite de historial por plan (F4.3). `AuthModule` aporta el adaptador de
// correo con que salen los informes programados (F9.8c).
@Module({
  imports: [AnalyticsModule, PlansModule, AuthModule],
  controllers: [ReportsController, ReportShareLinksController, ReportSchedulesController, PublicReportsController],
  providers: [ReportsService, ReportShareService, ReportScheduleService, ReportScheduleRunner],
  exports: [ReportsService],
})
export class ReportsModule {}
