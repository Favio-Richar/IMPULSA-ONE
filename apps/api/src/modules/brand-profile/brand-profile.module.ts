import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { PlatformBrandingModule } from "../platform-branding/platform-branding.module.js";
import { BrandProfileController } from "./brand-profile.controller.js";
import { BrandProfileService } from "./brand-profile.service.js";

@Module({
  imports: [AuditModule, PlatformBrandingModule],
  controllers: [BrandProfileController],
  providers: [BrandProfileService],
  exports: [BrandProfileService],
})
export class BrandProfileModule {}
