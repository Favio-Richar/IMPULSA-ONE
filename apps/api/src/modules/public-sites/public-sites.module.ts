import { Module } from "@nestjs/common";
import { ThemesModule } from "../themes/themes.module.js";
import { SlugAvailabilityController } from "./slug-availability.controller.js";
import { PublicSitesController } from "./public-sites.controller.js";
import { PublicSitesService } from "./public-sites.service.js";
import { RevalidateWebService } from "./revalidate-web.service.js";

@Module({
  imports: [ThemesModule],
  controllers: [PublicSitesController, SlugAvailabilityController],
  providers: [PublicSitesService, RevalidateWebService],
  // `PageVersionsService` (módulo `pages`) llama a `RevalidateWebService` después de publicar o
  // restaurar — es quien de verdad sabe cuándo el contenido público cambió.
  exports: [RevalidateWebService, PublicSitesService],
})
export class PublicSitesModule {}
