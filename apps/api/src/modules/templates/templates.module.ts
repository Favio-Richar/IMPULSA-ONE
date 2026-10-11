import { Module } from "@nestjs/common";
import { BlocksModule } from "../blocks/blocks.module.js";
import { PagesModule } from "../pages/pages.module.js";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { ApplyTemplateController } from "./apply-template.controller.js";
import { ApplyTemplateService } from "./apply-template.service.js";
import { PrivateTemplatesController } from "./private-templates.controller.js";
import { PrivateTemplatesService } from "./private-templates.service.js";
import { TemplatesController } from "./templates.controller.js";
import { TemplatesService } from "./templates.service.js";

@Module({
  // Aplicar una plantilla (PL4) escribe bloques por la misma puerta que el constructor
  // (`BlocksService`), mira el historial de versiones (`PageVersionsService`) y, al cambiar el tema
  // en vivo, avisa a apps/web (`RevalidateWebService`).
  imports: [BlocksModule, PagesModule, PublicSitesModule],
  controllers: [TemplatesController, ApplyTemplateController, PrivateTemplatesController],
  providers: [TemplatesService, ApplyTemplateService, PrivateTemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
