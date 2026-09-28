import { Module } from "@nestjs/common";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { ThemesModule } from "../themes/themes.module.js";
import { PageHealthService } from "./page-health.service.js";
import { PageVersionsService } from "./page-versions.service.js";
import { PagesController } from "./pages.controller.js";
import { PagesService } from "./pages.service.js";

@Module({
  // `PublicSitesModule` exporta `RevalidateWebService`: publicar y restaurar avisan a apps/web
  // para invalidar su caché de inmediato (F2.7).
  imports: [PublicSitesModule, ThemesModule],
  controllers: [PagesController],
  providers: [PagesService, PageVersionsService, PageHealthService],
  exports: [PagesService, PageVersionsService],
})
export class PagesModule {}
