import { Module } from "@nestjs/common";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { SmartCtaController } from "./smart-cta.controller.js";
import { SmartCtaService } from "./smart-cta.service.js";

// Smart CTA (F6.6). Guardar invalida la caché del sitio público (las reglas rigen en vivo).
@Module({
  imports: [PublicSitesModule],
  controllers: [SmartCtaController],
  providers: [SmartCtaService],
})
export class SmartCtaModule {}
