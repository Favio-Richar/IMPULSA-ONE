import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";

// Global: la auditoría se usa desde cualquier módulo de dominio (auth, organizations, y los que
// vengan) sin tener que importar AuditModule en cada uno — mismo patrón que PrismaModule.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
