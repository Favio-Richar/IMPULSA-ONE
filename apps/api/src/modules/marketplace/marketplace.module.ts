import { Module } from "@nestjs/common";
import { MarketplaceService } from "./marketplace.service.js";
import { OrganizationMarketplaceController, PublicMarketplaceController } from "./marketplace.controllers.js";

// Marketplace de integraciones y plantillas (F10.6, ADR-029). `WebhooksModule` es global: aporta `WebhooksService`.
// El controlador de revisión (`AdminMarketplaceController`) se registra en `AdminModule`, que trae la puerta de administración.
@Module({
  controllers: [PublicMarketplaceController, OrganizationMarketplaceController],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
