import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { AdminAuthService } from "./admin-auth.service.js";
import { AdminAuthController, AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";

// Módulo aparte con su propia puerta (ADR-002 §4, ADR-005): no importa ni reutiliza los guards de
// organización. `AuthModule` solo aporta la verificación de contraseña y el bloqueo por intentos;
// `PublicSitesModule`, la invalidación de la caché pública al bloquear o restaurar.
@Module({
  imports: [AuthModule, PublicSitesModule],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminAuthService, AdminService],
})
export class AdminModule {}
