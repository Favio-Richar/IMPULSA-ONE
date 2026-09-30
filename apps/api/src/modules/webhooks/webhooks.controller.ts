import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { webhookDeliveryDetailResponse, webhookDeliveryResponse, webhookEndpointResponse, webhookSecretResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import {
  createWebhookEndpointSchema,
  listWebhookDeliveriesQuerySchema,
  sendWebhookTestSchema,
  updateWebhookEndpointSchema,
  WEBHOOK_DELIVERY_STATUSES,
  type CreateWebhookEndpointInput,
  type ListWebhookDeliveriesQuery,
  type SendWebhookTestInput,
  type UpdateWebhookEndpointInput,
} from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiUuidParam, ApiZodArrayResponse, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { WebhooksService } from "./webhooks.service.js";

const NOT_FOUND = "Destino (o entrega) no encontrado, o de otra organización (ADR-002).";

// Todo exige `webhooks.manage` (OWNER y ADMIN, ADR-017): la URL puede llevar el token de Zapier o
// Make y las entregas llevan datos de clientes, así que ni siquiera el listado es para todos.
@ApiTags("webhooks")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/webhooks")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.WEBHOOKS_MANAGE)
  @ApiOperation({ summary: "Listar los destinos de webhooks", description: "Con el estado, las fallas seguidas y las entregas de los últimos 7 días. Nunca el secreto (F7.2)." })
  @ApiZodArrayResponse(200, webhookEndpointResponse, "Destinos de la organización.")
  async list(@Param("organizationId") organizationId: string) {
    return this.webhooks.list(organizationId);
  }

  @Post()
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.WEBHOOKS_MANAGE)
  @RateLimit({ limit: 20, windowSeconds: 600, keyPrefix: "webhooks-create" })
  @ApiOperation({
    summary: "Crear un destino",
    description: "URL `https` pública (sin usuario ni contraseña, puerto 443, sin IPs literales) y los eventos. Devuelve el secreto de firma **una sola vez** (ADR-017).",
  })
  @ApiZodBody(createWebhookEndpointSchema)
  @ApiZodResponse(201, webhookSecretResponse, "Destino creado y activo, con su secreto.")
  @ApiResponse({ status: 409, description: "`WEBHOOK_URL_TAKEN`: ya hay un destino con esa URL." })
  @ApiResponse({ status: 422, description: "`WEBHOOK_LIMIT_REACHED`: ya hay 10 destinos." })
  @ApiRateLimited(20, 600)
  async create(@Param("organizationId") organizationId: string, @CurrentUser() user: User, @Body(new ZodValidationPipe(createWebhookEndpointSchema)) body: CreateWebhookEndpointInput) {
    return this.webhooks.create(organizationId, user.id, body);
  }

  @Patch(":endpointId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.WEBHOOKS_MANAGE)
  @ApiOperation({ summary: "Editar, pausar o reanudar un destino", description: "Reanudar uno desactivado por el sistema reinicia la cuenta de fallas." })
  @ApiUuidParam("endpointId", "Destino.")
  @ApiZodBody(updateWebhookEndpointSchema)
  @ApiZodResponse(200, webhookEndpointResponse, "Destino actualizado.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: "`WEBHOOK_URL_TAKEN`." })
  async update(
    @Param("organizationId") organizationId: string,
    @Param("endpointId") endpointId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(updateWebhookEndpointSchema)) body: UpdateWebhookEndpointInput,
  ) {
    return this.webhooks.update(organizationId, user.id, endpointId, body);
  }

  @Delete(":endpointId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.WEBHOOKS_MANAGE)
  @ApiOperation({ summary: "Borrar un destino", description: "También borra su registro de entregas." })
  @ApiUuidParam("endpointId", "Destino.")
  @ApiResponse({ status: 204, description: "Borrado." })
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async remove(@Param("organizationId") organizationId: string, @Param("endpointId") endpointId: string, @CurrentUser() user: User): Promise<void> {
    await this.webhooks.remove(organizationId, user.id, endpointId);
  }

  @Post(":endpointId/rotate-secret")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.WEBHOOKS_MANAGE)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "webhooks-rotate" })
  @ApiOperation({ summary: "Rotar el secreto", description: "El anterior deja de valer de inmediato. El nuevo se devuelve una sola vez." })
  @ApiUuidParam("endpointId", "Destino.")
  @ApiZodResponse(201, webhookSecretResponse, "Secreto nuevo.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiRateLimited(10, 600)
  async rotate(@Param("organizationId") organizationId: string, @Param("endpointId") endpointId: string, @CurrentUser() user: User) {
    return this.webhooks.rotateSecret(organizationId, user.id, endpointId);
  }

  @Post(":endpointId/test")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.WEBHOOKS_MANAGE)
  @RateLimit({ limit: 10, windowSeconds: 60, keyPrefix: "webhooks-test" })
  @ApiOperation({
    summary: "Enviar un evento de prueba",
    description: "Un `ping` o el ejemplo firmado de un evento (`test: true`, datos inventados) para que Zapier o Make aprendan los campos. Queda en el registro de entregas.",
  })
  @ApiUuidParam("endpointId", "Destino.")
  @ApiZodBody(sendWebhookTestSchema)
  @ApiZodResponse(201, webhookDeliveryResponse, "Entrega encolada.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 422, description: "`WEBHOOK_ENDPOINT_INACTIVE`: el destino está pausado o desactivado." })
  @ApiRateLimited(10, 60)
  async test(
    @Param("organizationId") organizationId: string,
    @Param("endpointId") endpointId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(sendWebhookTestSchema)) body: SendWebhookTestInput,
  ) {
    return this.webhooks.sendTest(organizationId, user.id, endpointId, body);
  }

  @Get(":endpointId/deliveries")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.WEBHOOKS_MANAGE)
  @ApiOperation({ summary: "Registro de entregas", description: "Las últimas 50 (se guardan 30 días): estado, código, duración, error e intentos." })
  @ApiUuidParam("endpointId", "Destino.")
  @ApiQuery({ name: "status", required: false, enum: WEBHOOK_DELIVERY_STATUSES })
  @ApiZodArrayResponse(200, webhookDeliveryResponse, "Entregas, de la más reciente a la más antigua.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async deliveries(
    @Param("organizationId") organizationId: string,
    @Param("endpointId") endpointId: string,
    @Query(new ZodValidationPipe(listWebhookDeliveriesQuerySchema)) query: ListWebhookDeliveriesQuery,
  ) {
    return this.webhooks.deliveries(organizationId, endpointId, query);
  }

  @Get(":endpointId/deliveries/:deliveryId")
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.WEBHOOKS_MANAGE)
  @ApiOperation({ summary: "Detalle de una entrega", description: "Con el cuerpo enviado (lleva datos de clientes del negocio)." })
  @ApiUuidParam("endpointId", "Destino.")
  @ApiUuidParam("deliveryId", "Entrega.")
  @ApiZodResponse(200, webhookDeliveryDetailResponse, "Entrega.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  async delivery(@Param("organizationId") organizationId: string, @Param("endpointId") endpointId: string, @Param("deliveryId") deliveryId: string) {
    return this.webhooks.delivery(organizationId, endpointId, deliveryId);
  }

  @Post(":endpointId/deliveries/:deliveryId/redeliver")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.WEBHOOKS_MANAGE)
  @RateLimit({ limit: 30, windowSeconds: 600, keyPrefix: "webhooks-redeliver" })
  @ApiOperation({ summary: "Reenviar una entrega", description: "El mismo evento (mismo id), con el ciclo de reintentos completo." })
  @ApiUuidParam("endpointId", "Destino.")
  @ApiUuidParam("deliveryId", "Entrega.")
  @ApiZodResponse(201, webhookDeliveryResponse, "Entrega encolada de nuevo.")
  @ApiResponse({ status: 404, description: NOT_FOUND })
  @ApiResponse({ status: 409, description: "`WEBHOOK_DELIVERY_PENDING`: todavía se está intentando." })
  @ApiResponse({ status: 422, description: "`WEBHOOK_ENDPOINT_INACTIVE`." })
  @ApiRateLimited(30, 600)
  async redeliver(@Param("organizationId") organizationId: string, @Param("endpointId") endpointId: string, @Param("deliveryId") deliveryId: string, @CurrentUser() user: User) {
    return this.webhooks.redeliver(organizationId, user.id, endpointId, deliveryId);
  }
}
