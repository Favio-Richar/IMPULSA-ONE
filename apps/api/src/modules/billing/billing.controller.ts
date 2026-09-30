import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { billingOverviewResponse, billingSubscriptionResponse, checkoutRedirectResponse, withdrawalResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import { startCheckoutSchema, type StartCheckoutInput } from "@impulza/validation";
import type { Response } from "express";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { env } from "../../env.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { BillingService } from "./billing.service.js";

// Ver el plan de pago y los cobros: cualquier miembro activo (como leer el plan, F4.1). Contratar:
// solo el dueño (`billing.manage`, ADR-012).
@ApiTags("billing")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/billing")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @ApiOperation({
    summary: "Suscripción de pago, cobros y pasarelas disponibles",
    description: "La suscripción con derecho (o la última terminada), los últimos 24 cobros y las pasarelas que este ambiente ofrece. Nunca datos de tarjeta más allá de marca y últimos 4 dígitos (F4.6a).",
  })
  @ApiZodResponse(200, billingOverviewResponse, "Estado de facturación de la organización.")
  async overview(@Param("organizationId") organizationId: string, @Req() req: RequestWithMembership) {
    return this.billing.overview(organizationId, req.membership.roleId);
  }

  @Post("checkout")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.BILLING_MANAGE)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "billing-checkout" })
  @ApiOperation({
    summary: "Contratar un plan de pago",
    description:
      "Exige aceptar los Términos y el aviso de retracto (se guardan con su versión). Devuelve a dónde llevar el navegador para inscribir la tarjeta en la pasarela; el cobro se hace al volver.",
  })
  @ApiZodBody(startCheckoutSchema)
  @ApiZodResponse(201, checkoutRedirectResponse, "Redirección a la pasarela.")
  @ApiResponse({ status: 404, description: "Plan no encontrado." })
  @ApiResponse({ status: 409, description: "`SUBSCRIPTION_ACTIVE`: ya hay un plan de pago activo." })
  @ApiResponse({ status: 422, description: "`GATEWAY_UNAVAILABLE`, `PLAN_NOT_PURCHASABLE` o `GATEWAY_ERROR`." })
  @ApiRateLimited(10, 600)
  async checkout(@Param("organizationId") organizationId: string, @CurrentUser() user: User, @Body(new ZodValidationPipe(startCheckoutSchema)) body: StartCheckoutInput) {
    return this.billing.startCheckout(organizationId, user, body);
  }

  @Post("cancel")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.BILLING_MANAGE)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "billing-cancel" })
  @ApiOperation({
    summary: "Cancelar el plan de pago",
    description: "Término por el mismo medio en que se contrató (Ley 19.496): sin trámites. Sigue vigente hasta el fin del período pagado y no se vuelve a cobrar.",
  })
  @ApiZodResponse(200, billingSubscriptionResponse, "Suscripción cancelada al fin del período.")
  @ApiResponse({ status: 404, description: "`NO_SUBSCRIPTION`: no hay un plan de pago activo." })
  @ApiResponse({ status: 409, description: "`ALREADY_CANCELED`." })
  @ApiRateLimited(10, 600)
  async cancel(@Param("organizationId") organizationId: string, @CurrentUser() user: User) {
    return this.billing.cancel(organizationId, user);
  }

  @Post("resume")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.BILLING_MANAGE)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "billing-resume" })
  @ApiOperation({ summary: "Reanudar un plan cancelado", description: "Solo mientras el período pagado siga vigente; vuelve a renovarse con la misma tarjeta." })
  @ApiZodResponse(200, billingSubscriptionResponse, "Suscripción reanudada.")
  @ApiResponse({ status: 404, description: "`NO_SUBSCRIPTION`." })
  @ApiResponse({ status: 409, description: "`NOT_RESUMABLE`: no está cancelada o ya terminó." })
  @ApiRateLimited(10, 600)
  async resume(@Param("organizationId") organizationId: string, @CurrentUser() user: User) {
    return this.billing.resume(organizationId, user);
  }

  @Post("withdraw")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.BILLING_MANAGE)
  @RateLimit({ limit: 5, windowSeconds: 600, keyPrefix: "billing-withdraw" })
  @ApiOperation({
    summary: "Ejercer el derecho a retracto",
    description: "Dentro de los 10 días desde el primer cobro (Ley 19.496 art. 3 bis b): cancela de inmediato y reembolsa el 100 % por la misma pasarela. La cuenta vuelve a Gratis sin perder contenido.",
  })
  @ApiZodResponse(200, withdrawalResponse, "Plan cancelado y monto reembolsado.")
  @ApiResponse({ status: 404, description: "`NO_SUBSCRIPTION`." })
  @ApiResponse({ status: 409, description: "`ALREADY_CANCELED`." })
  @ApiResponse({ status: 422, description: "`WITHDRAWAL_EXPIRED` o `GATEWAY_UNAVAILABLE`." })
  @ApiResponse({ status: 502, description: "`REFUND_FAILED`: la pasarela no reembolsó; el plan sigue igual." })
  @ApiRateLimited(5, 600)
  async withdraw(@Param("organizationId") organizationId: string, @CurrentUser() user: User) {
    return this.billing.withdraw(organizationId, user);
  }
}

/**
 * Retorno de Transbank tras la inscripción (F4.6a). Transbank hace un POST de formulario desde su
 * sitio, así que llega **sin sesión ni cabecera anti-CSRF**: la única credencial es `TBK_TOKEN`,
 * secreto y de un solo uso. Siempre responde con una redirección al panel.
 */
@ApiTags("billing")
@Controller("billing/webpay")
export class WebpayReturnController {
  constructor(private readonly billing: BillingService) {}

  @Post("return")
  @HttpCode(HttpStatus.SEE_OTHER)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowSeconds: 600, keyPrefix: "billing-webpay-return" })
  @ApiExcludeEndpoint()
  async returnPost(@Body() body: Record<string, unknown>, @Res() res: Response) {
    await this.finish(body?.TBK_TOKEN, res);
  }

  @Get("return")
  @HttpCode(HttpStatus.SEE_OTHER)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowSeconds: 600, keyPrefix: "billing-webpay-return" })
  @ApiExcludeEndpoint()
  async returnGet(@Query("TBK_TOKEN") token: unknown, @Res() res: Response) {
    await this.finish(token, res);
  }

  private async finish(token: unknown, res: Response): Promise<void> {
    const outcome = await this.billing.completeWebpayReturn(typeof token === "string" ? token : undefined);
    res.redirect(HttpStatus.SEE_OTHER, `${env.APP_BASE_URL.replace(/\/+$/, "")}/plan?pago=${outcome}`);
  }
}

/**
 * Mercado Pago (F4.6b): el regreso del cliente tras autorizar y los avisos (webhooks). Ninguno lleva
 * sesión: el regreso solo sirve para consultar a Mercado Pago el estado real, y el aviso vale solo si
 * su firma `x-signature` es correcta.
 */
@ApiTags("billing")
@Controller("billing/mercadopago")
export class MercadoPagoController {
  constructor(private readonly billing: BillingService) {}

  @Get("return")
  @HttpCode(HttpStatus.SEE_OTHER)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowSeconds: 600, keyPrefix: "billing-mp-return" })
  @ApiExcludeEndpoint()
  async returnGet(@Query("preapproval_id") preapprovalId: unknown, @Res() res: Response) {
    const outcome = await this.billing.completeMercadoPagoReturn(typeof preapprovalId === "string" ? preapprovalId : undefined);
    res.redirect(HttpStatus.SEE_OTHER, `${env.APP_BASE_URL.replace(/\/+$/, "")}/plan?pago=${outcome}`);
  }

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 600, windowSeconds: 60, keyPrefix: "billing-mp-webhook" })
  @ApiExcludeEndpoint()
  async webhook(
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    // Mercado Pago manda el id del recurso en `?data.id=` (y también en el cuerpo). La firma se calcula
    // sobre el de la URL; el tipo se toma de la URL o del cuerpo.
    const dataId = typeof query["data.id"] === "string" ? query["data.id"] : undefined;
    const type = typeof query.type === "string" ? query.type : typeof body?.type === "string" ? body.type : undefined;
    const notificationId = typeof body?.id === "string" || typeof body?.id === "number" ? String(body.id) : undefined;
    return this.billing.handleMercadoPagoWebhook({ signature, requestId, dataId, type, notificationId });
  }
}
