import { Module } from "@nestjs/common";
import { BlocksModule } from "../blocks/blocks.module.js";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { AbTestsController } from "./ab-tests.controller.js";
import { AbTestsService } from "./ab-tests.service.js";

// Pruebas A/B (F6.5, ADR-011). Aplicar B usa la edición normal de bloques; empezar o terminar
// invalida la caché del sitio público para que el reparto cambie de inmediato.
@Module({
  imports: [BlocksModule, PublicSitesModule],
  controllers: [AbTestsController],
  providers: [AbTestsService],
})
export class AbTestsModule {}
