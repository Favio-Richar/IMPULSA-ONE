import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { SupportModule } from "../support/support.module.js";
import { AdminAuthService } from "./admin-auth.service.js";
import { AdminAuthController, AdminController, AdminSupportController } from "./admin.controller.js";
import { AdminOperationsController } from "./admin-operations.controller.js";
import { AdminOperationsService } from "./admin-operations.service.js";
import { AdminService } from "./admin.service.js";

// Módulo aparte con su propia puerta (ADR-002 §4, ADR-005): no importa ni reutiliza los guards de
// organización. `AuthModule` solo aporta la verificación de contraseña y el bloqueo por intentos;
// `PublicSitesModule`, la invalidación de la caché pública al bloquear o restaurar; `SupportModule`,
// la bandeja de soporte del equipo (F4.5).
@Module({
  imports: [AuthModule, PublicSitesModule, SupportModule],
  controllers: [AdminAuthController, AdminController, AdminSupportController, AdminOperationsController],
  providers: [AdminAuthService, AdminService, AdminOperationsService],
  exports: [AdminOperationsService],
})
export class AdminModule {}
