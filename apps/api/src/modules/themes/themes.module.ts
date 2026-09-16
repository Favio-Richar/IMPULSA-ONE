import { Module } from "@nestjs/common";
import { ThemesController } from "./themes.controller.js";
import { ThemesService } from "./themes.service.js";

@Module({
  controllers: [ThemesController],
  providers: [ThemesService],
  // Lo usa SitesModule para resolver qué temas puede aplicar una organización a sus sitios.
  exports: [ThemesService],
})
export class ThemesModule {}
