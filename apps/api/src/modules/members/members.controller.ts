import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { memberSettingsResponse, siteMemberListResponse, siteMemberResponse } from "@impulza/contracts";
import { PERMISSIONS } from "@impulza/database";
import {
  addMemberSchema,
  listMembersQuerySchema,
  setPageMembersOnlySchema,
  type AddMemberDto,
  type ListMembersQueryDto,
  type SetPageMembersOnlyDto,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiRateLimited,
  ApiUuidParam,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { MembersService } from "./members.service.js";

const uuid = new ZodValidationPipe(uuidParamSchema);

/** Miembros de un sitio y páginas solo para miembros, desde el panel (F10.1). Permiso `member.manage`. */
@ApiTags("members")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/members")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard, RateLimitGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "members-list" })
  @ApiOperation({ summary: "Miembros del sitio", description: "Búsqueda por correo o nombre, filtro de estado y paginación en el servidor." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodResponse(200, siteMemberListResponse, "Una página de miembros.")
  @ApiRateLimited(120, 60)
  list(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Query(new ZodValidationPipe(listMembersQuerySchema)) query: ListMembersQueryDto,
  ) {
    return this.members.list(organizationId, siteId, query);
  }

  @Get("settings")
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "members-settings" })
  @ApiOperation({ summary: "Páginas del sitio y cuáles son solo para miembros" })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodResponse(200, memberSettingsResponse, "Páginas y número de miembros activos.")
  @ApiRateLimited(120, 60)
  settings(@Param("organizationId") organizationId: string, @Param("siteId", uuid) siteId: string) {
    return this.members.settings(organizationId, siteId);
  }

  @Put("pages/:pageId")
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "members-page" })
  @ApiOperation({
    summary: "Marcar una página como solo para miembros (o quitarlo)",
    description: "En vivo: surte efecto al invalidar la caché pública, sin republicar. Queda auditado.",
  })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("pageId", "Página.")
  @ApiZodBody(setPageMembersOnlySchema)
  @ApiZodResponse(200, memberSettingsResponse, "Páginas del sitio actualizadas.")
  @ApiResponse({ status: 404, description: "Sitio o página no encontrados en esta organización." })
  @ApiRateLimited(60, 60)
  setPage(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("pageId", uuid) pageId: string,
    @Body(new ZodValidationPipe(setPageMembersOnlySchema)) body: SetPageMembersOnlyDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.members.setPageMembersOnly(organizationId, siteId, pageId, body.enabled, req.user.id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "members-add" })
  @ApiOperation({ summary: "Dar de alta a un miembro", description: "Opcionalmente le envía su enlace de acceso. Reactiva a un miembro revocado." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodBody(addMemberSchema)
  @ApiZodResponse(201, siteMemberResponse, "El miembro.")
  @ApiResponse({ status: 409, description: "Ya es miembro, o el sitio llegó a su tope." })
  @ApiRateLimited(60, 60)
  add(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.members.add(organizationId, siteId, req.user.id, body);
  }

  @Post(":memberId/revoke")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "members-revoke" })
  @ApiOperation({ summary: "Revocar a un miembro", description: "Pierde el acceso en el acto: sesiones revocadas y enlaces pendientes inutilizados." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("memberId", "Miembro.")
  @ApiZodResponse(200, siteMemberResponse, "El miembro revocado.")
  @ApiRateLimited(60, 60)
  revoke(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("memberId", uuid) memberId: string,
    @Req() req: RequestWithMembership,
  ) {
    return this.members.revoke(organizationId, siteId, memberId, req.user.id);
  }

  @Post(":memberId/restore")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "members-restore" })
  @ApiOperation({ summary: "Reactivar a un miembro revocado" })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("memberId", "Miembro.")
  @ApiZodResponse(200, siteMemberResponse, "El miembro reactivado.")
  @ApiRateLimited(60, 60)
  restore(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("memberId", uuid) memberId: string,
    @Req() req: RequestWithMembership,
  ) {
    return this.members.restore(organizationId, siteId, memberId, req.user.id);
  }

  @Delete(":memberId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "members-remove" })
  @ApiOperation({ summary: "Quitar a un miembro y sus datos", description: "Borra a la persona (derecho de supresión). La auditoría guarda solo el identificador." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("memberId", "Miembro.")
  @ApiResponse({ status: 204, description: "Miembro eliminado." })
  @ApiRateLimited(60, 60)
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("memberId", uuid) memberId: string,
    @Req() req: RequestWithMembership,
  ): Promise<void> {
    await this.members.remove(organizationId, siteId, memberId, req.user.id);
  }
}
