import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CustomRolesController } from "./custom-roles.controller.js";
import { CustomRolesService } from "./custom-roles.service.js";
import { MembershipsController } from "./memberships.controller.js";
import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsService } from "./organizations.service.js";

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController, MembershipsController, CustomRolesController],
  providers: [OrganizationsService, CustomRolesService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
