import { Module } from "@nestjs/common";
import { createProvider } from "@impulza/ai";
import { AnalyticsModule } from "../analytics/analytics.module.js";
import { PagesModule } from "../pages/pages.module.js";
import { AdminAiController } from "./admin-ai.controller.js";
import { AdminAiService } from "./admin-ai.service.js";
import { AiController } from "./ai.controller.js";
import { AI_PROVIDER_FACTORY, AiService } from "./ai.service.js";
import { PageAiController } from "./page-ai.controller.js";
import { PageAiService } from "./page-ai.service.js";
import { SiteInsightsController } from "./site-insights.controller.js";
import { SiteInsightsService } from "./site-insights.service.js";

@Module({
  // F6.4 lee la analítica agregada y la salud de página con los mismos servicios del panel.
  imports: [AnalyticsModule, PagesModule],
  controllers: [AiController, AdminAiController, PageAiController, SiteInsightsController],
  // La fábrica de adaptadores es un proveedor inyectable para que las pruebas usen `FakeProvider`
  // (sin red ni claves), igual que `EMAIL_ADAPTER` con el correo.
  providers: [AiService, AdminAiService, PageAiService, SiteInsightsService, { provide: AI_PROVIDER_FACTORY, useValue: createProvider }],
  exports: [AiService],
})
export class AiModule {}
