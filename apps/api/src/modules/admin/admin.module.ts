import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ModerationModule } from "../moderation/moderation.module.js";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { SupportModule } from "../support/support.module.js";
import { AdminAuthService } from "./admin-auth.service.js";
import { AdminAuthController, AdminController, AdminSupportController } from "./admin.controller.js";
import { AdminOperationsController } from "./admin-operations.controller.js";
import { AdminOperationsService } from "./admin-operations.service.js";
import { AdminService } from "./admin.service.js";
import { AdminAbuseReportsController } from "../moderation/admin-abuse-reports.controller.js";
import { ModerationAdminService } from "../moderation/moderation-admin.service.js";

// Módulo aparte con su propia puerta (ADR-002 §4, ADR-005): no importa ni reutiliza los guards de
// organización. `AuthModule` solo aporta la verificación de contraseña y el bloqueo por intentos;
// `PublicSitesModule`, la invalidación de la caché pública al bloquear o restaurar; `SupportModule`,
// la bandeja de soporte del equipo (F4.5). La cola de moderación (F9.9b) vive en `modules/moderation` pero se sirve
// desde acá: comparte la puerta de administración y necesita bloquear/restaurar organizaciones con `AdminService`.
@Module({
  imports: [AuthModule, PublicSitesModule, SupportModule, ModerationModule],
  controllers: [AdminAuthController, AdminController, AdminSupportController, AdminOperationsController, AdminAbuseReportsController],
  providers: [AdminAuthService, AdminService, AdminOperationsService, ModerationAdminService],
  exports: [AdminOperationsService],
})
export class AdminModule {}
