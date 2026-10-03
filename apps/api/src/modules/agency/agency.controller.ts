import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { agencyClientResponse, agencyDashboardResponse, agencyOverviewResponse, agencyStatusResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  agencyClientActionSchema,
  agencyDashboardQuerySchema,
  agencyOverviewQuerySchema,
  createAgencyClientSchema,
  linkAgencyClientSchema,
  type AgencyClientActionDto,
  type AgencyDashboardQuery,
  type AgencyOverviewQuery,
  type CreateAgencyClientDto,
  type LinkAgencyClientDto,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import {
  ApiOrganizationIdParam,
  ApiOrganizationScopedErrors,
  ApiPlanLimited,
  ApiRateLimited,
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
import { AgencyDashboardService } from "./agency-dashboard.service.js";
import { AgencyService } from "./agency.service.js";

/**
 * Lado de la agencia (F9.3, ADR-028 §2). `:organizationId` es la organización **agencia**, resuelta con la
 * membresía real del usuario (ADR-002): estos endpoints nunca aceptan «de qué agencia hablo» desde el cuerpo.
 */
@ApiTags("agency")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/agency")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class AgencyController {
  constructor(
    private readonly agencyService: AgencyService,
    private readonly dashboardService: AgencyDashboardService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Estado del modo agencia de la organización",
    description: "Si es agencia, si su plan incluye cupo de clientes y cuánto usa. Solo pide membresía activa.",
  })
  @ApiZodResponse(200, agencyStatusResponse, "Estado del modo agencia.")
  async status(@Param("organizationId") organizationId: string) {
    return this.agencyService.getStatus(organizationId);
  }

  @Post("enable")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_LINK_MANAGE)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "agency-enable" })
  @ApiOperation({
    summary: "Activar el modo agencia",
    description: "Solo el propietario, y solo si el plan trae cupo de clientes. Un negocio que ya es cliente de otra agencia no puede serlo.",
  })
  @ApiZodResponse(200, agencyStatusResponse, "Modo agencia activo.")
  @ApiRateLimited(10, 60)
  @ApiResponse({ status: 403, description: "Tu plan no incluye el modo agencia (`AGENCY_PLAN_REQUIRED`) o falta el permiso." })
  @ApiResponse({ status: 409, description: "Este negocio es cliente de una agencia." })
  async enable(@Param("organizationId") organizationId: string, @CurrentUser() user: User) {
    return this.agencyService.enable(organizationId, user.id);
  }

  @Get("dashboard")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({
    summary: "Panel de la agencia: totales de sus clientes",
    description:
      "Clientes por estado y, **solo de los clientes `ACTIVE`**, visitas, clics, contactos nuevos, reservas y pedidos del período, más las alertas (dominios, cupo del plan, sitio oculto). Un cliente en pausa, archivado o sin aceptar no suma. Nunca incluye la suscripción ni los pagos del cliente. Requiere `agency.manage`.",
  })
  @ApiQuery({ name: "days", required: false, description: "Período que termina hoy: 7, 30 (por defecto) o 90 días." })
  @ApiZodResponse(200, agencyDashboardResponse, "Consolidado de la agencia.")
  @ApiResponse({ status: 400, description: "`days` distinto de 7, 30 o 90." })
  @ApiResponse({ status: 403, description: "La organización no es una agencia (`NOT_AN_AGENCY`) o falta el permiso." })
  async dashboard(@Param("organizationId") organizationId: string, @Query(new ZodValidationPipe(agencyDashboardQuerySchema)) query: AgencyDashboardQuery) {
    return this.dashboardService.dashboard(organizationId, query);
  }

  @Get("overview")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({
    summary: "Tabla de clientes con su rendimiento, plan, dominios y alertas",
    description:
      "Búsqueda por nombre o identificador, filtro por estado, orden (`name`, `status`, `createdAt`) y paginación en el servidor (máximo 50 por página). El rendimiento, plan, dominios y alertas solo se calculan para los clientes `ACTIVE`; el resto viene en `null`. Requiere `agency.manage`.",
  })
  @ApiQuery({ name: "days", required: false, description: "Período: 7, 30 (por defecto) o 90 días." })
  @ApiQuery({ name: "search", required: false, description: "Texto en el nombre o el identificador del cliente." })
  @ApiQuery({ name: "status", required: false, description: "Estado de la relación." })
  @ApiQuery({ name: "sort", required: false, description: "`name`, `status` o `createdAt` (por defecto)." })
  @ApiQuery({ name: "order", required: false, description: "`asc` o `desc` (por defecto)." })
  @ApiQuery({ name: "page", required: false, description: "Página, desde 1." })
  @ApiQuery({ name: "pageSize", required: false, description: "Tamaño de página, 1 a 50 (20 por defecto)." })
  @ApiZodResponse(200, agencyOverviewResponse, "Una página de clientes.")
  @ApiResponse({ status: 400, description: "Algún parámetro fuera de rango." })
  @ApiResponse({ status: 403, description: "La organización no es una agencia (`NOT_AN_AGENCY`) o falta el permiso." })
  async overview(@Param("organizationId") organizationId: string, @Query(new ZodValidationPipe(agencyOverviewQuerySchema)) query: AgencyOverviewQuery) {
    return this.dashboardService.overview(organizationId, query);
  }

  @Get("clients")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({ summary: "Listar los clientes de la agencia", description: "Relaciones abiertas (las terminadas no aparecen). Requiere `agency.manage`." })
  @ApiZodArrayResponse(200, agencyClientResponse, "Clientes de la agencia.")
  @ApiResponse({ status: 403, description: "La organización no es una agencia (`NOT_AN_AGENCY`) o falta el permiso." })
  async listClients(@Param("organizationId") organizationId: string) {
    return this.agencyService.listClients(organizationId);
  }

  @Post("clients")
  @ApiPlanLimited("clients")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-client-create" })
  @ApiOperation({
    summary: "Dar de alta un cliente nuevo",
    description:
      "Crea la organización del cliente, da acceso delegado a la agencia desde el primer día e invita por correo al propietario (enlace firmado de un solo uso que vence en 7 días).",
  })
  @ApiZodBody(createAgencyClientSchema)
  @ApiZodResponse(201, agencyClientResponse, "Cliente creado; el propietario aún no aceptó.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 402, description: "Llegaste al cupo de clientes de tu plan (`PLAN_LIMIT_REACHED`)." })
  @ApiResponse({ status: 409, description: "Ese identificador ya está en uso." })
  async createClient(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createAgencyClientSchema)) body: CreateAgencyClientDto,
  ) {
    return this.agencyService.createClient(organizationId, user, body);
  }

  @Post("clients/link")
  @ApiPlanLimited("clients")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  // Límite bajo a propósito: pide identificador y correo del propietario, y no debe servir para sondear negocios.
  @RateLimit({ limit: 8, windowSeconds: 60, keyPrefix: "agency-client-link" })
  @ApiOperation({
    summary: "Pedir acceso a un negocio que ya existe",
    description:
      "Requiere el identificador del negocio **y** el correo de su propietario. Queda pendiente: la agencia no tiene acceso hasta que el propietario acepte (consentimiento del cliente).",
  })
  @ApiZodBody(linkAgencyClientSchema)
  @ApiZodResponse(201, agencyClientResponse, "Solicitud creada, pendiente del propietario.")
  @ApiRateLimited(8, 60)
  @ApiResponse({ status: 404, description: "No encontramos un negocio con esos datos." })
  @ApiResponse({ status: 409, description: "Ese negocio ya trabaja con una agencia." })
  async requestLink(
    @Param("organizationId") organizationId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(linkAgencyClientSchema)) body: LinkAgencyClientDto,
  ) {
    return this.agencyService.requestLink(organizationId, user, body);
  }

  @Post("clients/:clientId/actions")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "agency-client-action" })
  @ApiOperation({
    summary: "Pausar, reanudar, archivar, desarchivar o soltar a un cliente",
    description:
      "Pausa = la agencia solo ve. Archivo = sin acceso, reversible. Soltar termina la relación. Ninguna acción borra datos del cliente. Al pausar o archivar, `hidePublicSite: true` oculta además el sitio público del cliente (reversible: reanudar, desarchivar o soltar lo muestran de nuevo).",
  })
  @ApiUuidParam("clientId", "Identificador de la relación con el cliente (no el de su organización).")
  @ApiZodBody(agencyClientActionSchema)
  @ApiZodResponse(200, agencyClientResponse, "Cliente actualizado.")
  @ApiRateLimited(60, 60)
  @ApiResponse({ status: 404, description: "Ese cliente no existe en tu agencia." })
  @ApiResponse({ status: 409, description: "Esa acción no se puede hacer desde el estado actual." })
  async act(
    @Param("organizationId") organizationId: string,
    @Param("clientId", new ParseUUIDPipe()) clientId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(agencyClientActionSchema)) body: AgencyClientActionDto,
  ) {
    return this.agencyService.actOnClient(organizationId, user.id, clientId, body.action, body.hidePublicSite);
  }
}
