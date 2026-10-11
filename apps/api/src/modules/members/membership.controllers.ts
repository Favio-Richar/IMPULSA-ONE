import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
  membershipCheckoutResponse,
  membershipPlanListResponse,
  membershipPlanResponse,
  publicMembershipPlansResponse,
  publicMembershipStatusResponse,
} from "@impulza/contracts";
import { MembershipPlanStatus, PERMISSIONS } from "@impulza/database";
import {
  createMembershipPlanSchema,
  startMembershipCheckoutSchema,
  updateMembershipPlanSchema,
  type CreateMembershipPlanDto,
  type StartMembershipCheckoutDto,
  type UpdateMembershipPlanDto,
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
import { MEMBERSHIP_STATUS_NOT_FOUND, MembershipCheckoutService } from "./membership-checkout.service.js";
import { MembershipPlansService } from "./membership-plans.service.js";

const uuid = new ZodValidationPipe(uuidParamSchema);

/** Planes de membresía de un sitio, desde el panel (F10.2). Permiso `member.manage`. */
@ApiTags("members")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/members/plans")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard, RateLimitGuard)
export class MembershipPlansController {
  constructor(private readonly plans: MembershipPlansService) {}

  @Get()
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "membership-plans-list" })
  @ApiOperation({ summary: "Planes del sitio, miembros vigentes y lo cobrado en el mes", description: "Indica si el cobro en línea está disponible (cuenta de Mercado Pago conectada)." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodResponse(200, membershipPlanListResponse, "Planes, disponibilidad del cobro e ingresos del mes.")
  @ApiRateLimited(120, 60)
  list(@Param("organizationId") organizationId: string, @Param("siteId", uuid) siteId: string) {
    return this.plans.list(organizationId, siteId);
  }

  @Post()
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "membership-plans-create" })
  @ApiOperation({ summary: "Crear un plan de membresía", description: "Precio en la unidad mínima de la moneda; periodo mensual o anual prepagado." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodBody(createMembershipPlanSchema)
  @ApiZodResponse(201, membershipPlanResponse, "El plan.")
  @ApiResponse({ status: 409, description: "Tope de planes activos o moneda no compatible con Mercado Pago." })
  @ApiRateLimited(30, 60)
  create(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Body(new ZodValidationPipe(createMembershipPlanSchema)) body: CreateMembershipPlanDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.plans.create(organizationId, siteId, req.user.id, body);
  }

  @Put(":planId")
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "membership-plans-update" })
  @ApiOperation({ summary: "Editar un plan", description: "Solo afecta compras futuras: cada compra guarda copia de lo que se pagó." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("planId", "Plan.")
  @ApiZodBody(updateMembershipPlanSchema)
  @ApiZodResponse(200, membershipPlanResponse, "El plan actualizado.")
  @ApiRateLimited(60, 60)
  update(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("planId", uuid) planId: string,
    @Body(new ZodValidationPipe(updateMembershipPlanSchema)) body: UpdateMembershipPlanDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.plans.update(organizationId, siteId, planId, req.user.id, body);
  }

  @Post(":planId/archive")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "membership-plans-archive" })
  @ApiOperation({ summary: "Archivar un plan", description: "Deja de ofrecerse; quienes ya pagaron conservan su periodo." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("planId", "Plan.")
  @ApiZodResponse(200, membershipPlanResponse, "El plan archivado.")
  @ApiRateLimited(60, 60)
  archive(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("planId", uuid) planId: string,
    @Req() req: RequestWithMembership,
  ) {
    return this.plans.setStatus(organizationId, siteId, planId, req.user.id, MembershipPlanStatus.ARCHIVED);
  }

  @Post(":planId/restore")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "membership-plans-restore" })
  @ApiOperation({ summary: "Volver a ofrecer un plan archivado" })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiUuidParam("planId", "Plan.")
  @ApiZodResponse(200, membershipPlanResponse, "El plan activo.")
  @ApiRateLimited(60, 60)
  restore(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Param("planId", uuid) planId: string,
    @Req() req: RequestWithMembership,
  ) {
    return this.plans.setStatus(organizationId, siteId, planId, req.user.id, MembershipPlanStatus.ACTIVE);
  }
}

/** Planes y compra de membresías para el visitante (F10.2). Sin sesión: el correo identifica a quien compra. */
@ApiTags("public-members")
@Controller("public/sites/:siteSlug/members/plans")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicMembershipPlansController {
  constructor(private readonly checkout: MembershipCheckoutService) {}

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-membership-plans" })
  @ApiOperation({
    summary: "Planes de membresía que se pueden comprar",
    description: "Vacío si el negocio no conectó su cuenta de Mercado Pago: no se ofrece lo que no se puede cobrar.",
  })
  @ApiZodResponse(200, publicMembershipPlansResponse, "Planes activos del sitio.")
  @ApiResponse({ status: 404, description: "El sitio no existe o no está publicado." })
  @ApiRateLimited(120, 60)
  plans(@Param("siteSlug") siteSlug: string) {
    return this.checkout.publicPlans(siteSlug);
  }

  @Post(":planId/checkout")
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-membership-checkout" })
  @ApiOperation({
    summary: "Comprar un periodo de un plan",
    description: "Crea el cobro en la cuenta de Mercado Pago del negocio. El precio sale del plan guardado, nunca del cuerpo. Devuelve dónde pagar y el enlace «Tu membresía».",
  })
  @ApiZodBody(startMembershipCheckoutSchema)
  @ApiZodResponse(201, membershipCheckoutResponse, "Dónde pagar y dónde ver el estado.")
  @ApiResponse({ status: 404, description: "Plan o sitio no encontrados." })
  @ApiResponse({ status: 409, description: "Este correo no puede comprar." })
  @ApiResponse({ status: 503, description: "El pago en línea no está disponible." })
  @ApiRateLimited(10, 600)
  start(
    @Param("siteSlug") siteSlug: string,
    @Param("planId") planId: string,
    @Body(new ZodValidationPipe(startMembershipCheckoutSchema)) body: StartMembershipCheckoutDto,
  ) {
    return this.checkout.start(siteSlug, planId, body);
  }
}

/** «Tu membresía»: sin sesión; el enlace del correo (o el regreso desde Mercado Pago) es la credencial. */
@ApiTags("public-members")
@Controller("public/memberships/purchases/:token")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicMembershipStatusController {
  constructor(private readonly checkout: MembershipCheckoutService) {}

  @Get()
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "public-membership-status" })
  @ApiOperation({
    summary: "Estado de una compra de membresía con su enlace",
    description: "Con `paymentId` (el `payment_id` con que vuelve Mercado Pago) consulta ese pago con el token del negocio antes de responder; la URL nunca se toma como verdad.",
  })
  @ApiQuery({ name: "paymentId", required: false, description: "Id del pago en Mercado Pago, tal como vuelve el comprador." })
  @ApiZodResponse(200, publicMembershipStatusResponse, "La compra y su estado de pago.")
  @ApiResponse({ status: 404, description: MEMBERSHIP_STATUS_NOT_FOUND })
  @ApiRateLimited(60, 60)
  status(@Param("token") token: string, @Query("paymentId") paymentId: unknown) {
    return this.checkout.publicStatus(token, typeof paymentId === "string" ? paymentId : undefined);
  }
}

/**
 * Avisos de Mercado Pago sobre el pago de una membresía (F10.2). Sin sesión ni CSRF (los manda Mercado Pago): vale solo con la firma
 * `x-signature` de la aplicación, y aun así el pago se consulta con el token del negocio antes de aplicar nada.
 */
@ApiTags("public-members")
@Controller("payments/mercadopago/memberships/:purchaseId")
export class MembershipPaymentWebhookController {
  constructor(private readonly checkout: MembershipCheckoutService) {}

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 600, windowSeconds: 60, keyPrefix: "memberships-mp-webhook" })
  @ApiExcludeEndpoint()
  async webhook(
    @Param("purchaseId") purchaseId: string,
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    const dataId = typeof query["data.id"] === "string" ? query["data.id"] : undefined;
    const type = typeof query.type === "string" ? query.type : typeof body?.type === "string" ? body.type : undefined;
    return this.checkout.handleWebhook({ purchaseId, signature, requestId, dataId, type });
  }
}
