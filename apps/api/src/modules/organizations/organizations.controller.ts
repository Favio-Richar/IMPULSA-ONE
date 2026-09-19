import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { invitationResponse, memberResponse, organizationResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiSessionScopedErrors,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { changeRoleSchema, type ChangeRoleDto } from "./dto/change-role.dto.js";
import { createOrganizationSchema, type CreateOrganizationDto } from "./dto/create-organization.dto.js";
import { inviteMemberSchema, type InviteMemberDto } from "./dto/invite-member.dto.js";
import { OrganizationMembershipGuard } from "./guards/organization-membership.guard.js";
import { OrganizationsService } from "./organizations.service.js";

const MEMBERSHIP_NOT_FOUND = "La membresía no existe en esta organización.";

// Los dos primeros endpoints no llevan OrganizationMembershipGuard a propósito: crear una
// organización y listar las propias son anteriores a tener membresía en una concreta. De ahí que
// el ámbito de errores no sea el mismo en todo el controlador.
@ApiTags("organizations")
@ApiCookieAuth(SESSION_AUTH)
@Controller("organizations")
@UseGuards(CsrfGuard, SessionAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({
    summary: "Crear una organización",
    description:
      "Quien la crea queda como OWNER con membresía activa. El slug es interno (no resuelve una URL pública) pero es único en la plataforma.",
  })
  @ApiZodBody(createOrganizationSchema)
  @ApiZodResponse(201, organizationResponse, "Organización creada, con el creador como OWNER.")
  @ApiResponse({ status: 409, description: "Ese slug ya está en uso." })
  @ApiSessionScopedErrors()
  async create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createOrganizationSchema)) body: CreateOrganizationDto,
  ) {
    return this.organizationsService.createOrganization(user, body.name, body.slug);
  }

  @Get()
  @ApiOperation({
    summary: "Listar mis organizaciones",
    description: "Solo aquellas donde el usuario tiene membresía activa. Es el punto de entrada del panel.",
  })
  @ApiZodArrayResponse(200, organizationResponse, "Organizaciones del usuario autenticado.")
  @ApiSessionScopedErrors()
  async listMine(@CurrentUser() user: User) {
    return this.organizationsService.listMyOrganizations(user.id);
  }

  @Get(":organizationId")
  @UseGuards(OrganizationMembershipGuard)
  @ApiOperation({ summary: "Leer una organización" })
  @ApiOrganizationIdParam()
  @ApiZodResponse(200, organizationResponse, "La organización solicitada.")
  @ApiResponse({
    status: 404,
    description: "No existe, o el usuario no tiene membresía activa en ella (ADR-002).",
  })
  @ApiOrganizationScopedErrors()
  async getOne(@Param("organizationId") organizationId: string) {
    return this.organizationsService.getOrganization(organizationId);
  }

  @Get(":organizationId/members")
  @UseGuards(OrganizationMembershipGuard)
  @ApiOperation({
    summary: "Listar los miembros",
    description:
      "Por antigüedad de invitación. Los removidos no aparecen. Leer solo pide membresía activa, no un permiso.",
  })
  @ApiOrganizationIdParam()
  @ApiZodArrayResponse(200, memberResponse, "Miembros e invitaciones pendientes.")
  @ApiOrganizationScopedErrors()
  async listMembers(@Param("organizationId") organizationId: string) {
    return this.organizationsService.listMembers(organizationId);
  }

  @Post(":organizationId/members")
  @UseGuards(OrganizationMembershipGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.ORGANIZATION_MEMBERS_INVITE)
  @ApiOperation({
    summary: "Invitar a una persona",
    description:
      "Requiere el permiso `organization.members.invite`. La invitación queda en estado `INVITED` hasta que la persona la acepta en `POST /memberships/:membershipId/accept`.",
  })
  @ApiOrganizationIdParam()
  @ApiZodBody(inviteMemberSchema)
  @ApiZodResponse(201, invitationResponse, "Invitación creada, pendiente de aceptación.")
  @ApiResponse({
    status: 404,
    description: "No existe una cuenta registrada con ese correo todavía.",
  })
  @ApiResponse({
    status: 409,
    description: "Esa persona ya es miembro o tiene una invitación pendiente.",
  })
  @ApiOrganizationScopedErrors()
  async inviteMember(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: InviteMemberDto,
  ) {
    return this.organizationsService.inviteMember(organizationId, user.id, body.email, body.role);
  }

  @Patch(":organizationId/members/:membershipId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OrganizationMembershipGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE)
  @ApiOperation({
    summary: "Cambiar el rol de un miembro",
    description:
      "Requiere el permiso `organization.members.update_role`. El rol OWNER queda fuera: transferir la propiedad no es un cambio de rol más.",
  })
  @ApiOrganizationIdParam()
  @ApiUuidParam("membershipId", "Membresía a modificar, no el id de usuario.")
  @ApiZodBody(changeRoleSchema)
  @ApiResponse({ status: 204, description: "Rol actualizado." })
  @ApiResponse({ status: 403, description: "El rol de OWNER no se cambia por esta vía." })
  @ApiResponse({ status: 404, description: MEMBERSHIP_NOT_FOUND })
  @ApiOrganizationScopedErrors()
  async changeRole(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: ChangeRoleDto,
  ): Promise<void> {
    await this.organizationsService.changeRole(organizationId, user.id, membershipId, body.role);
  }

  @Delete(":organizationId/members/:membershipId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(OrganizationMembershipGuard, PermissionGuard)
  @RequirePermission(PERMISSIONS.ORGANIZATION_MEMBERS_REMOVE)
  @ApiOperation({
    summary: "Remover a un miembro",
    description:
      "Requiere el permiso `organization.members.remove`. La membresía pasa a `REMOVED` y conserva su historial de auditoría; no se borra la fila.",
  })
  @ApiOrganizationIdParam()
  @ApiUuidParam("membershipId", "Membresía a remover, no el id de usuario.")
  @ApiResponse({ status: 204, description: "Miembro removido." })
  @ApiResponse({ status: 403, description: "No se puede remover al OWNER de la organización." })
  @ApiResponse({ status: 404, description: MEMBERSHIP_NOT_FOUND })
  @ApiOrganizationScopedErrors()
  async removeMember(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.organizationsService.removeMember(organizationId, user.id, membershipId);
  }
}
