import { Module } from "@nestjs/common";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { PageCampaignsController } from "./page-campaigns.controller.js";
import { PageCampaignsService } from "./page-campaigns.service.js";

@Module({
  // `RevalidateWebService`: cada cambio de una campaña se ve en la página pública al instante.
  imports: [PublicSitesModule],
  controllers: [PageCampaignsController],
  providers: [PageCampaignsService],
})
export class PageCampaignsModule {}
