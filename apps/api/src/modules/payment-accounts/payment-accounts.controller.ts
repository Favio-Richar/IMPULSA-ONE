import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { paymentAccountConnectResponse, paymentAccountsResponse } from "@impulza/contracts";
import { PERMISSIONS, type User } from "@impulza/database";
import type { Response } from "express";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { env } from "../../env.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { PaymentAccountsService } from "./payment-accounts.service.js";

// Ver el estado: cualquier miembro activo. Conectar o desconectar: solo el dueño
// (`payments.connect`, ADR-013) — decide a qué cuenta llega el dinero de las ventas.
@ApiTags("payment-accounts")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/payment-accounts")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class PaymentAccountsController {
  constructor(private readonly accounts: PaymentAccountsService) {}

  @Get()
  @ApiOperation({ summary: "Cuenta de cobro del negocio", description: "Si hay una cuenta de Mercado Pago conectada y en qué estado. Nunca tokens (F5.8, ADR-013)." })
  @ApiZodResponse(200, paymentAccountsResponse, "Estado de la cuenta de cobro.")
  async status(@Param("organizationId") organizationId: string, @Req() req: RequestWithMembership) {
    return this.accounts.status(organizationId, req.membership.roleId);
  }

  @Post("mercadopago/connect")
  @UseGuards(PermissionGuard, RateLimitGuard)
  @RequirePermission(PERMISSIONS.PAYMENTS_CONNECT)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "payments-connect" })
  @ApiOperation({ summary: "Empezar a conectar Mercado Pago", description: "Devuelve la URL de autorización de Mercado Pago (OAuth con PKCE y `state` de un solo uso, 10 minutos)." })
  @ApiZodResponse(201, paymentAccountConnectResponse, "URL a la que llevar al dueño.")
  @ApiResponse({ status: 422, description: "`PAYMENTS_UNAVAILABLE`: la aplicación de Mercado Pago no está configurada." })
  @ApiRateLimited(10, 600)
  async connect(@Param("organizationId") organizationId: string, @CurrentUser() user: User) {
    return this.accounts.startConnect(organizationId, user.id);
  }

  @Delete("mercadopago")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(PermissionGuard)
  @RequirePermission(PERMISSIONS.PAYMENTS_CONNECT)
  @ApiOperation({ summary: "Desconectar Mercado Pago", description: "Borra los tokens guardados. Los cobros vuelven a enlaces de pago externos. Queda auditado." })
  @ApiResponse({ status: 204, description: "Desconectada." })
  @ApiResponse({ status: 404, description: "`NOT_CONNECTED`." })
  async disconnect(@Param("organizationId") organizationId: string, @CurrentUser() user: User) {
    await this.accounts.disconnect(organizationId, user.id);
  }
}

/**
 * Regreso desde Mercado Pago tras autorizar (F5.8). Llega sin cabecera anti-CSRF (es una
 * redirección del navegador): la única credencial es el `state` de un solo uso, y el permiso se
 * vuelve a comprobar. Siempre responde con una redirección al panel.
 */
@ApiTags("payment-accounts")
@Controller("payments/mercadopago/oauth")
export class MercadoPagoOAuthCallbackController {
  constructor(private readonly accounts: PaymentAccountsService) {}

  @Get("callback")
  @HttpCode(HttpStatus.SEE_OTHER)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowSeconds: 600, keyPrefix: "payments-oauth-callback" })
  @ApiExcludeEndpoint()
  async callback(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const text = (value: unknown) => (typeof value === "string" ? value : undefined);
    const outcome = await this.accounts.completeConnect({ code: text(query.code), state: text(query.state), error: text(query.error) });
    res.redirect(HttpStatus.SEE_OTHER, `${env.APP_BASE_URL.replace(/\/+$/, "")}/cobros?conexion=${outcome}`);
  }
}
