import { Global, Module } from "@nestjs/common";
import { OrganizationPlanController, PlansCatalogController } from "./plans.controller.js";
import { PlansService } from "./plans.service.js";

// Global: cada módulo que crea un recurso con límite (sitios, formularios, contactos, enlaces, QR,
// miembros — F4.2) necesita `PlansService` para verificarlo, igual que `AuditModule`.
@Global()
@Module({
  controllers: [PlansCatalogController, OrganizationPlanController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
