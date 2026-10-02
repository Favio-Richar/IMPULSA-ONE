import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AdminSessionGuard } from "../admin/guards/admin-session.guard.js";
import { PlatformBrandingController } from "./platform-branding.controller.js";
import { AdminPlatformBrandingController } from "./admin-platform-branding.controller.js";
import { PlatformBrandingService } from "./platform-branding.service.js";

@Module({
  imports: [AuditModule],
  controllers: [PlatformBrandingController, AdminPlatformBrandingController],
  providers: [PlatformBrandingService, AdminSessionGuard],
  exports: [PlatformBrandingService],
})
export class PlatformBrandingModule {}
