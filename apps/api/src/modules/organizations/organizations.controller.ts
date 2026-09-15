import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { User } from "@impulza/database";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { changeRoleSchema, type ChangeRoleDto } from "./dto/change-role.dto.js";
import { createOrganizationSchema, type CreateOrganizationDto } from "./dto/create-organization.dto.js";
import { inviteMemberSchema, type InviteMemberDto } from "./dto/invite-member.dto.js";
import { OrganizationMembershipGuard } from "./guards/organization-membership.guard.js";
import { OrganizationsService } from "./organizations.service.js";
import type { RequestWithMembership } from "./request-with-membership.js";

@Controller("organizations")
@UseGuards(CsrfGuard, SessionAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  async create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createOrganizationSchema)) body: CreateOrganizationDto,
  ) {
    return this.organizationsService.createOrganization(user, body.name, body.slug);
  }

  @Get()
  async listMine(@CurrentUser() user: User) {
    return this.organizationsService.listMyOrganizations(user.id);
  }

  @Get(":organizationId")
  @UseGuards(OrganizationMembershipGuard)
  async getOne(@Param("organizationId") organizationId: string) {
    return this.organizationsService.getOrganization(organizationId);
  }

  @Get(":organizationId/members")
  @UseGuards(OrganizationMembershipGuard)
  async listMembers(@Param("organizationId") organizationId: string) {
    return this.organizationsService.listMembers(organizationId);
  }

  @Post(":organizationId/members")
  @UseGuards(OrganizationMembershipGuard)
  async inviteMember(
    @Param("organizationId") organizationId: string,
    @Req() req: RequestWithMembership,
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: InviteMemberDto,
  ) {
    return this.organizationsService.inviteMember(organizationId, req.membership, body.email, body.role);
  }

  @Patch(":organizationId/members/:membershipId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OrganizationMembershipGuard)
  async changeRole(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Req() req: RequestWithMembership,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: ChangeRoleDto,
  ): Promise<void> {
    await this.organizationsService.changeRole(organizationId, req.membership, membershipId, body.role);
  }

  @Delete(":organizationId/members/:membershipId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OrganizationMembershipGuard)
  async removeMember(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Req() req: RequestWithMembership,
  ): Promise<void> {
    await this.organizationsService.removeMember(organizationId, req.membership, membershipId);
  }
}
