import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { PublicLinksController } from "./public-links.controller.js";
import { PublicLinksService } from "./public-links.service.js";

@Module({
  imports: [AnalyticsModule],
  controllers: [PublicLinksController],
  providers: [PublicLinksService],
})
export class PublicLinksModule {}
