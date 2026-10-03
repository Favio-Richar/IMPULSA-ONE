import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PublicSitesModule } from "../public-sites/public-sites.module.js";
import { AgencyAccessService } from "./agency-access.service.js";
import { AgencyBillingService } from "./agency-billing.service.js";
import { AgencyDashboardService } from "./agency-dashboard.service.js";
import { AgencyInvitationsController, AgencyLinkController } from "./agency-link.controller.js";
import { AgencyController } from "./agency.controller.js";
import { AgencyService } from "./agency.service.js";

// Global: `OrganizationsService` sincroniza el acceso delegado cuando cambia el equipo de una agencia, y no debe
// importar este módulo (y arrastrar sus controladores) en cada lugar donde se usa.
@Global()
@Module({
  // `AuthModule` aporta el adaptador de correo (invitaciones y avisos); `PublicSitesModule`, el aviso a apps/web al ocultar o mostrar un sitio.
  imports: [AuthModule, PublicSitesModule],
  controllers: [AgencyController, AgencyLinkController, AgencyInvitationsController],
  providers: [AgencyService, AgencyAccessService, AgencyDashboardService, AgencyBillingService],
  exports: [AgencyService, AgencyAccessService],
})
export class AgencyModule {}
