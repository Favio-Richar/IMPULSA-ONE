import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { MembersController } from "./members.controller.js";
import { MembersService } from "./members.service.js";
import { PublicMembersController } from "./public-members.controller.js";

// Miembros de sitio y contenido protegido (F10.1, ADR-029). `AuthModule` aporta el adaptador de correo; `PublicSitesModule`, el
// render de la página y la invalidación de caché.
@Module({
  imports: [AuthModule, PublicSitesModule],
  controllers: [PublicMembersController, MembersController],
  providers: [MembersService],
})
export class MembersModule {}
