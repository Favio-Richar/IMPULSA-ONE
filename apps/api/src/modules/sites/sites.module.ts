import { Module } from "@nestjs/common";
import { ThemesModule } from "../themes/themes.module.js";
import { SitesController } from "./sites.controller.js";
import { SitesService } from "./sites.service.js";

@Module({
  // Aplicar un tema a un sitio necesita la regla de "qué temas ve esta organización" (F2.5).
  imports: [ThemesModule],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
