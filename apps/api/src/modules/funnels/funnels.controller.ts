import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { funnelReportResponse, funnelResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  createFunnelSchema,
  FUNNEL_DEVICES,
  funnelReportQuerySchema,
  updateFunnelSchema,
  type CreateFunnelInput,
  type FunnelReportQuery,
  type UpdateFunnelInput,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiPlanLimited,
  ApiUuidParam,
  ApiZodArrayResponse,
  ApiZodBody,
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { FunnelsService } from "./funnels.service.js";

const NOT_FOUND = "Sitio o embudo no encontrado, o de otra organización (ADR-002).";

// Embudos de conversión (F7.6, ADR-021). Leer, cualquier miembro (como el resto de la analítica);
// escribir, `page.manage` (el mismo permiso que las pruebas A/B, F6.5).
@ApiTags("funnels")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/funnels")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class FunnelsController {
  constructor(private readonly funnelsService: FunnelsService) {}

  @Get()
  @ApiOperation({ summary: "Listar los embudos del sitio", description: "En orden de creación, con el nombre legible de la página o el bloque de cada paso." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodArrayResponse(200, funnelResponse, "Embudos del sitio.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async list(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string) {
    return this.funnelsService.list(organizationId, siteId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({
    summary: "Crear un embudo",
    description: "De 2 a 6 pasos con eventos del catálogo; hasta 10 embudos por sitio. Una página o un bloque de un paso tiene que ser de este sitio.",
  })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodBody(createFunnelSchema)
  @ApiZodResponse(201, funnelResponse, "Embudo creado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 422, description: "`FUNNEL_LIMIT_REACHED` (10 por sitio) o `FUNNEL_SUBJECT_INVALID` (página o bloque de otro sitio)." })
  async create(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createFunnelSchema)) body: CreateFunnelInput,
  ) {
    return this.funnelsService.create(organizationId, user.id, siteId, body);
  }

  @Get(":funnelId")
  @ApiOperation({ summary: "Leer un embudo" })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("funnelId", "Embudo del sitio.")
  @ApiZodResponse(200, funnelResponse, "El embudo.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async get(@Param("organizationId") organizationId: string, @Param("siteId") siteId: string, @Param("funnelId") funnelId: string) {
    return this.funnelsService.get(organizationId, siteId, funnelId);
  }

  @Patch(":funnelId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({ summary: "Editar un embudo", description: "Los pasos se envían completos (y en el orden nuevo), nunca a medias." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("funnelId", "Embudo del sitio.")
  @ApiZodBody(updateFunnelSchema)
  @ApiZodResponse(200, funnelResponse, "Embudo actualizado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 422, description: "`FUNNEL_SUBJECT_INVALID`: página o bloque de otro sitio." })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("funnelId") funnelId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateFunnelSchema)) body: UpdateFunnelInput,
  ) {
    return this.funnelsService.update(organizationId, user.id, siteId, funnelId, body);
  }

  @Delete(":funnelId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAGE_MANAGE)
  @ApiOperation({ summary: "Borrar un embudo", description: "Solo la definición: los eventos de analítica no se tocan." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("funnelId", "Embudo del sitio.")
  @ApiResponse({ status: 204, description: "Embudo borrado." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async remove(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("funnelId") funnelId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.funnelsService.remove(organizationId, user.id, siteId, funnelId);
  }

  @Get(":funnelId/report")
  @ApiOperation({
    summary: "Informe del embudo",
    description:
      "Visitas (personas-día anonimizadas, ADR-004) que hacen los pasos en orden dentro del rango, con conversión, abandono y tiempo mediano entre pasos (ADR-021). El pago cuenta aunque llegue después del rango. Respeta el historial del plan.",
  })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("funnelId", "Embudo del sitio.")
  @ApiQuery({ name: "from", required: true, description: "Fecha inicial (YYYY-MM-DD, UTC)." })
  @ApiQuery({ name: "to", required: true, description: "Fecha final incluida (YYYY-MM-DD, UTC). Hasta 366 días de rango." })
  @ApiQuery({ name: "device", required: false, enum: FUNNEL_DEVICES, description: "Dispositivo de la visita al entrar al embudo." })
  @ApiZodResponse(200, funnelReportResponse, "Totales por paso.")
  @ApiResponse({ status: 400, description: "Rango o dispositivo inválido." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiPlanLimited("analyticsHistoryDays")
  async report(
    @Param("organizationId") organizationId: string,
    @Param("siteId") siteId: string,
    @Param("funnelId") funnelId: string,
    @Query(new ZodValidationPipe(funnelReportQuerySchema)) query: FunnelReportQuery,
  ) {
    return this.funnelsService.report(organizationId, siteId, funnelId, query);
  }
}
