import { Module } from "@nestjs/common";
import { AbuseReportsService } from "./abuse-reports.service.js";
import { PublicAbuseReportsController } from "./public-abuse-reports.controller.js";

@Module({
  controllers: [PublicAbuseReportsController],
  providers: [AbuseReportsService],
  exports: [AbuseReportsService],
})
export class ModerationModule {}
