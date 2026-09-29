import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { billingOverviewResponse, checkoutRedirectResponse } from "@impulza/contracts";
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
  async overview(@Param("organizationId") organizationId: string) {
    return this.billing.overview(organizationId);
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
