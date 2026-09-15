import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MembershipsController } from "./memberships.controller.js";
import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsService } from "./organizations.service.js";

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController, MembershipsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
