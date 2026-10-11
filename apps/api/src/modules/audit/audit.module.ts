import { Global, Module } from "@nestjs/common";
import { AgencyAuditController, OrganizationAuditController } from "./audit.controller.js";
import { AuditQueryService } from "./audit-query.service.js";
import { AuditService } from "./audit.service.js";

// Global: la auditoría se usa desde cualquier módulo de dominio (auth, organizations, y los que
// vengan) sin tener que importar AuditModule en cada uno — mismo patrón que PrismaModule.
@Global()
@Module({
  controllers: [OrganizationAuditController, AgencyAuditController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService],
})
export class AuditModule {}
