import { Module } from "@nestjs/common";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { ThemesModule } from "../themes/themes.module.js";
import { SitesController } from "./sites.controller.js";
import { SitesService } from "./sites.service.js";

@Module({
  // Aplicar un tema a un sitio necesita la regla de "qué temas ve esta organización" (F2.5).
  // Y `RevalidateWebService`: el tema y el fondo (PP3) se aplican en vivo, sin publicar.
  imports: [ThemesModule, PublicSitesModule],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
