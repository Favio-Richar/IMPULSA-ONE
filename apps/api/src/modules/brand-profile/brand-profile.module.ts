import { Global, Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PlatformBrandingModule } from "../platform-branding/platform-branding.module.js";
import { BrandProfileController } from "./brand-profile.controller.js";
import { BrandProfileService } from "./brand-profile.service.js";

// Global: la marca de la organización la usan, sin importar este módulo, quienes envían correos a los clientes
// del negocio (reservas, pedidos, newsletter, secuencias, campañas) y la aplicación de plantillas (F9.2).
@Global()
@Module({
  imports: [AuditModule, PlatformBrandingModule],
  controllers: [BrandProfileController],
  providers: [BrandProfileService],
  exports: [BrandProfileService],
})
export class BrandProfileModule {}
