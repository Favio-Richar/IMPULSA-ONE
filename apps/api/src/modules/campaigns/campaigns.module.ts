import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CampaignsController } from "./campaigns.controller.js";
import { CampaignsService } from "./campaigns.service.js";
import { PublicUnsubscribeController } from "./public-unsubscribe.controller.js";
import { PublicUnsubscribeService } from "./public-unsubscribe.service.js";

/** Campañas de email (F5.6). */
@Module({
  imports: [AuthModule],
  controllers: [CampaignsController, PublicUnsubscribeController],
  providers: [CampaignsService, PublicUnsubscribeService],
})
export class CampaignsModule {}
