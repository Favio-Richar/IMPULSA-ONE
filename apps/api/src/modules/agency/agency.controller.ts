import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  agencyBillingResponse,
  agencyClientResponse,
  agencyDashboardResponse,
  agencyDuplicateResponse,
  agencyIncomingTransfersResponse,
  agencyOverviewResponse,
  agencyStatusResponse,
  agencyTransferResponse,
} from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  agencyClientActionSchema,
  agencyDashboardQuerySchema,
  changeBillingSchema,
  createTransferSchema,
  duplicateClientSchema,
  agencyOverviewQuerySchema,
  createAgencyClientSchema,
  linkAgencyClientSchema,
  type AgencyClientActionDto,
  type AgencyDashboardQuery,
  type AgencyOverviewQuery,
  type ChangeBillingDto,
  type CreateTransferDto,
  type DuplicateClientDto,
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
import { AgencyBillingService } from "./agency-billing.service.js";
import { AgencyDashboardService } from "./agency-dashboard.service.js";
import { AgencyDuplicateService } from "./agency-duplicate.service.js";
import { AgencyTransferService } from "./agency-transfer.service.js";
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
    private readonly billingService: AgencyBillingService,
    private readonly transferService: AgencyTransferService,
    private readonly duplicateService: AgencyDuplicateService,
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

  @Get("clients/:clientId/billing")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({ summary: "Quién paga el plan de un cliente: modo vigente, propuesta pendiente e historial", description: "Requiere `agency.manage`." })
  @ApiUuidParam("clientId", "Identificador de la relación con el cliente (no el de su organización).")
  @ApiZodResponse(200, agencyBillingResponse, "Modo, propuesta pendiente (si hay) e historial.")
  @ApiResponse({ status: 404, description: "Ese cliente no existe en tu agencia." })
  async billing(@Param("organizationId") organizationId: string, @Param("clientId", new ParseUUIDPipe()) clientId: string) {
    return this.billingService.historyForAgency(organizationId, clientId);
  }

  @Post("clients/:clientId/billing")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-billing-request" })
  @ApiOperation({
    summary: "Proponer un cambio de quién paga el plan del cliente",
    description:
      "Queda pendiente hasta que el propietario del cliente lo confirme (le llega un aviso por correo). Con `AGENCY_PAYS` el negocio usa los límites del plan de la agencia; no se cobra nada nuevo. Si el cliente lo creó la agencia y su propietario aún no acepta la invitación, se aplica de inmediato (no hay a quién pedírselo). Requiere `agency.manage`.",
  })
  @ApiUuidParam("clientId", "Identificador de la relación con el cliente (no el de su organización).")
  @ApiZodBody(changeBillingSchema)
  @ApiZodResponse(200, agencyBillingResponse, "Estado de la facturación tras la solicitud.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 409, description: "Ya está en ese modo, ya hay una propuesta pendiente o la relación no está activa." })
  async requestBilling(
    @Param("organizationId") organizationId: string,
    @Param("clientId", new ParseUUIDPipe()) clientId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(changeBillingSchema)) body: ChangeBillingDto,
  ) {
    return this.billingService.requestChange(organizationId, user.id, clientId, body.billingMode);
  }

  @Post("clients/:clientId/billing/cancel")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-billing-cancel" })
  @ApiOperation({ summary: "Cancelar la propuesta de facturación pendiente", description: "Requiere `agency.manage`." })
  @ApiUuidParam("clientId", "Identificador de la relación con el cliente (no el de su organización).")
  @ApiZodResponse(200, agencyBillingResponse, "Estado de la facturación tras cancelar.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 409, description: "No hay una propuesta pendiente." })
  async cancelBilling(
    @Param("organizationId") organizationId: string,
    @Param("clientId", new ParseUUIDPipe()) clientId: string,
    @CurrentUser() user: User,
  ) {
    return this.billingService.cancelPending(organizationId, user.id, clientId);
  }

  @Get("clients/:clientId/transfer")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({ summary: "El traspaso más reciente de un cliente", description: "`transfer: null` si nunca hubo uno. Requiere `agency.manage`." })
  @ApiUuidParam("clientId", "Identificador de la relación con el cliente (no el de su organización).")
  @ApiZodResponse(200, agencyTransferResponse, "El traspaso más reciente (pendiente o decidido).")
  @ApiResponse({ status: 404, description: "Ese cliente no existe en tu agencia." })
  async transfer(@Param("organizationId") organizationId: string, @Param("clientId", new ParseUUIDPipe()) clientId: string) {
    return this.transferService.getForRelation(organizationId, clientId);
  }

  @Post("clients/:clientId/transfer")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "agency-transfer-start" })
  @ApiOperation({
    summary: "Traspasar un cliente a su propietario o a otra agencia",
    description:
      "Doble consentimiento: el propietario del negocio **siempre** debe aceptar, y la agencia receptora también si el destino es otra agencia (se la identifica con su identificador y el correo de su propietario). Mientras está pendiente no cambia nada: el cliente queda `TRANSFERRING` con el mismo acceso. Vence en 14 días. Solo un cliente `ACTIVE`. Al completarse cambia la relación, nunca se mueven datos. Requiere `agency.manage`.",
  })
  @ApiUuidParam("clientId", "Identificador de la relación con el cliente (no el de su organización).")
  @ApiZodBody(createTransferSchema)
  @ApiZodResponse(200, agencyTransferResponse, "El traspaso creado, pendiente de las partes.")
  @ApiRateLimited(10, 60)
  @ApiResponse({ status: 404, description: "No encontramos una agencia con esos datos, o el cliente no existe en tu agencia." })
  @ApiResponse({ status: 409, description: "El cliente no está activo, ya hay un traspaso en curso o el destino es tu propia agencia." })
  async startTransfer(
    @Param("organizationId") organizationId: string,
    @Param("clientId", new ParseUUIDPipe()) clientId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createTransferSchema)) body: CreateTransferDto,
  ) {
    return this.transferService.start(organizationId, user.id, clientId, body);
  }

  @Post("clients/:clientId/transfer/cancel")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-transfer-cancel" })
  @ApiOperation({ summary: "Cancelar el traspaso pendiente", description: "El cliente sigue activo en tu agencia. Requiere `agency.manage`." })
  @ApiUuidParam("clientId", "Identificador de la relación con el cliente (no el de su organización).")
  @ApiZodResponse(200, agencyTransferResponse, "El traspaso, ya cancelado.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 409, description: "No hay un traspaso pendiente." })
  async cancelTransfer(
    @Param("organizationId") organizationId: string,
    @Param("clientId", new ParseUUIDPipe()) clientId: string,
    @CurrentUser() user: User,
  ) {
    return this.transferService.cancel(organizationId, user.id, clientId);
  }

  @Get("transfers")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @ApiOperation({ summary: "Traspasos que otra agencia te ofrece", description: "Solo los pendientes de tu decisión. No incluye ningún dato del negocio, solo su nombre. Requiere `agency.manage`." })
  @ApiZodResponse(200, agencyIncomingTransfersResponse, "Traspasos pendientes dirigidos a esta agencia.")
  async incomingTransfers(@Param("organizationId") organizationId: string) {
    return this.transferService.incoming(organizationId);
  }

  @Post("transfers/:transferId/accept")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-transfer-accept" })
  @ApiOperation({
    summary: "Aceptar un cliente que otra agencia te traspasa",
    description: "Solo se completa si el propietario del negocio también acepta; necesita cupo de clientes en tu plan. Requiere `agency.manage`.",
  })
  @ApiUuidParam("transferId", "Identificador del traspaso.")
  @ApiZodResponse(200, agencyIncomingTransfersResponse, "Traspasos que siguen pendientes.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 404, description: "Ese traspaso no existe (o es de otra agencia)." })
  @ApiResponse({ status: 409, description: "El traspaso ya no está pendiente o tu plan no tiene cupo de clientes." })
  async acceptTransfer(
    @Param("organizationId") organizationId: string,
    @Param("transferId", new ParseUUIDPipe()) transferId: string,
    @CurrentUser() user: User,
  ) {
    return this.transferService.receiverAccept(organizationId, user.id, transferId);
  }

  @Post("transfers/:transferId/reject")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 60, keyPrefix: "agency-transfer-reject" })
  @ApiOperation({ summary: "Rechazar un cliente que otra agencia te traspasa", description: "El cliente sigue en la agencia que lo ofrecía. Requiere `agency.manage`." })
  @ApiUuidParam("transferId", "Identificador del traspaso.")
  @ApiZodResponse(200, agencyIncomingTransfersResponse, "Traspasos que siguen pendientes.")
  @ApiRateLimited(20, 60)
  @ApiResponse({ status: 404, description: "Ese traspaso no existe (o es de otra agencia)." })
  @ApiResponse({ status: 409, description: "El traspaso ya no está pendiente." })
  async rejectTransfer(
    @Param("organizationId") organizationId: string,
    @Param("transferId", new ParseUUIDPipe()) transferId: string,
    @CurrentUser() user: User,
  ) {
    return this.transferService.receiverReject(organizationId, user.id, transferId);
  }

  @Post("clients/:clientId/duplicate")
  @ApiPlanLimited("clients")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.AGENCY_MANAGE)
  @RateLimit({ limit: 5, windowSeconds: 60, keyPrefix: "agency-client-duplicate" })
  @ApiOperation({
    summary: "Duplicar un cliente en una organización nueva",
    description:
      "Crea un cliente NUEVO (con la invitación a su propietario, como «Nuevo cliente») y copia el contenido del sitio del origen: sitios, páginas, bloques, temas propios y colores de marca, todo en **borrador**. **Nunca** copia contactos, respuestas de formularios, pedidos, reservas, pagos, cuentas de cobro, claves, imágenes ni videos de la biblioteca, dominios, identificadores de medición, productos, servicios ni formularios: los bloques que apuntaban a ellos quedan sin configurar. Respeta el plan del cliente nuevo (sitios y páginas) e informa qué se omitió. Es idempotente por `idempotencyKey`: repetir la misma petición devuelve el mismo resultado (`replayed: true`) sin crear otro cliente; la misma clave con otra petición responde 409. Se hace todo o nada. Requiere `agency.manage` y cupo de clientes.",
  })
  @ApiUuidParam("clientId", "Identificador de la relación con el cliente que se duplica (no el de su organización).")
  @ApiZodBody(duplicateClientSchema)
  @ApiZodResponse(200, agencyDuplicateResponse, "El cliente nuevo y el informe de lo que se copió y lo que no.")
  @ApiRateLimited(5, 60)
  @ApiResponse({ status: 404, description: "Ese cliente no existe en tu agencia." })
  @ApiResponse({ status: 409, description: "Identificador en uso, clave de idempotencia reutilizada con otra petición, o el cliente no tiene una relación con acceso." })
  async duplicate(
    @Param("organizationId") organizationId: string,
    @Param("clientId", new ParseUUIDPipe()) clientId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(duplicateClientSchema)) body: DuplicateClientDto,
  ) {
    return this.duplicateService.duplicate(organizationId, user, clientId, body);
  }
}
