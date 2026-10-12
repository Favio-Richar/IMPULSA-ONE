import { Module } from "@nestjs/common";
import { PublicEngagementController, SiteEngagementController } from "./engagement.controllers.js";
import { EngagementService } from "./engagement.service.js";

// Vistas y «me gusta» públicos de las páginas (F10).
@Module({
  controllers: [PublicEngagementController, SiteEngagementController],
  providers: [EngagementService],
})
export class EngagementModule {}
