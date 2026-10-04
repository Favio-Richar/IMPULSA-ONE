import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { customRoleResponse, rolesResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { customRoleSchema, type CustomRoleDto } from "@impulza/validation";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CustomRolesService } from "./custom-roles.service.js";
import { OrganizationMembershipGuard } from "./guards/organization-membership.guard.js";
import type { RequestWithMembership } from "./request-with-membership.js";

const ESCALATION = "Intentó dar permisos que quien actúa no tiene (código `ESCALATION`, con la lista en `missing`), o editar el rol que esa persona misma tiene.";

@ApiTags("organizations")
@ApiCookieAuth(SESSION_AUTH)
@Controller("organizations/:organizationId/roles")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class CustomRolesController {
  constructor(private readonly customRolesService: CustomRolesService) {}

  @Get()
  @ApiOperation({
    summary: "Roles de la organización",
    description:
      "Los roles del sistema con sus permisos, los roles personalizados de la organización y los permisos de quien consulta. Basta ser miembro activo; una agencia con acceso delegado no llega aquí (`AGENCY_LIMIT`).",
  })
  @ApiOrganizationIdParam()
  @ApiZodResponse(200, rolesResponse, "Roles del sistema y personalizados.")
  @ApiOrganizationScopedErrors()
  list(@Param("organizationId") organizationId: string, @Req() req: RequestWithMembership) {
    return this.customRolesService.list(organizationId, req.membership);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE)
  @ApiOperation({
    summary: "Crear un rol personalizado",
    description: "Requiere `organization.members.update_role`. Los permisos salen del catálogo cerrado y nadie entrega permisos que no tiene. Hasta 20 roles por organización.",
  })
  @ApiOrganizationIdParam()
  @ApiZodBody(customRoleSchema)
  @ApiZodResponse(201, customRoleResponse, "Rol creado.")
  @ApiResponse({ status: 403, description: ESCALATION })
  @ApiResponse({ status: 409, description: "Ya hay un rol con ese nombre, o se llegó al tope de roles." })
  @ApiOrganizationScopedErrors()
  create(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Req() req: RequestWithMembership,
    @Body(new ZodValidationPipe(customRoleSchema)) body: CustomRoleDto,
  ) {
    return this.customRolesService.create(organizationId, user.id, req.membership, body);
  }

  @Put(":roleId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE)
  @ApiOperation({
    summary: "Editar un rol personalizado",
    description: "Reemplaza nombre, descripción y permisos. Quien lo edita debe tener todos los permisos del rol, los de antes y los nuevos, y no puede editar el rol que él mismo tiene.",
  })
  @ApiOrganizationIdParam()
  @ApiUuidParam("roleId", "Rol personalizado de esta organización.")
  @ApiZodBody(customRoleSchema)
  @ApiZodResponse(200, customRoleResponse, "Rol actualizado.")
  @ApiResponse({ status: 403, description: ESCALATION })
  @ApiResponse({ status: 404, description: "El rol no existe en esta organización." })
  @ApiResponse({ status: 409, description: "Ya hay un rol con ese nombre." })
  @ApiOrganizationScopedErrors()
  update(
    @Param("organizationId") organizationId: string,
    @Param("roleId") roleId: string,
    @CurrentUser() user: User,
    @Req() req: RequestWithMembership,
    @Body(new ZodValidationPipe(customRoleSchema)) body: CustomRoleDto,
  ) {
    return this.customRolesService.update(organizationId, user.id, req.membership, roleId, body);
  }

  @Delete(":roleId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.ORGANIZATION_MEMBERS_UPDATE_ROLE)
  @ApiOperation({ summary: "Borrar un rol personalizado", description: "Solo si nadie lo tiene: antes se reasignan sus miembros." })
  @ApiOrganizationIdParam()
  @ApiUuidParam("roleId", "Rol personalizado de esta organización.")
  @ApiResponse({ status: 204, description: "Rol borrado." })
  @ApiResponse({ status: 403, description: ESCALATION })
  @ApiResponse({ status: 404, description: "El rol no existe en esta organización." })
  @ApiResponse({ status: 409, description: "El rol está en uso." })
  @ApiOrganizationScopedErrors()
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("roleId") roleId: string,
    @CurrentUser() user: User,
    @Req() req: RequestWithMembership,
  ): Promise<void> {
    await this.customRolesService.remove(organizationId, user.id, req.membership, roleId);
  }
}
