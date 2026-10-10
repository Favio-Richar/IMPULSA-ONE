import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { ThemesModule } from "../themes/themes.module.js";
import { PageHealthService } from "./page-health.service.js";
import { PageVersionsService } from "./page-versions.service.js";
import { PagesController } from "./pages.controller.js";
import { PagesService } from "./pages.service.js";
import { PagePublishRequestsController, PublishRequestsController, PublishSettingsController } from "./publish-approval.controller.js";
import { PublishApprovalService } from "./publish-approval.service.js";

@Module({
  // `PublicSitesModule` exporta `RevalidateWebService`: publicar y restaurar avisan a apps/web
  // para invalidar su caché de inmediato (F2.7).
  // `AuthModule` aporta el adaptador de correo con que se avisa a quienes aprueban (F9.6c).
  imports: [PublicSitesModule, ThemesModule, AuthModule],
  controllers: [PagesController, PagePublishRequestsController, PublishRequestsController, PublishSettingsController],
  providers: [PagesService, PageVersionsService, PageHealthService, PublishApprovalService],
  exports: [PagesService, PageVersionsService, PageHealthService],
})
export class PagesModule {}
