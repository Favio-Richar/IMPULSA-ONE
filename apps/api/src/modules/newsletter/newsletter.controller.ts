import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { newsletterStatsResponse, publicNewsletterConfirmationResponse, publicNewsletterSignupResponse } from "@impulza/contracts";
import { newsletterSignupSchema } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { CONFIRMATION_NOT_FOUND, NEWSLETTER_NOT_FOUND, NewsletterService } from "./newsletter.service.js";

/**
 * Suscripción desde la página pública (F7.4, ADR-019). Sin sesión: el bloque de newsletter envía el
 * correo; el enlace del correo es la única credencial para confirmar.
 */
@ApiTags("public-newsletter")
@Controller("public")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicNewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Post("sites/:siteSlug/newsletter")
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-newsletter" })
  @ApiOperation({
    summary: "Pedir la suscripción a la newsletter",
    description: "Envía el correo de confirmación (48 h). La respuesta es siempre la misma, exista o no el contacto (ADR-019). No crea un contacto.",
  })
  @ApiZodBody(newsletterSignupSchema)
  @ApiZodResponse(202, publicNewsletterSignupResponse, "Revisar el correo.")
  @ApiResponse({ status: 404, description: NEWSLETTER_NOT_FOUND })
  @ApiRateLimited(10, 600)
  request(@Param("siteSlug") siteSlug: string, @Body() body: unknown) {
    return this.newsletter.request(siteSlug, body);
  }

  @Get("newsletter/:token")
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "public-newsletter-view" })
  @ApiOperation({ summary: "Ver a qué corresponde un enlace de confirmación" })
  @ApiZodResponse(200, publicNewsletterConfirmationResponse, "Negocio, correo enmascarado y estado.")
  @ApiResponse({ status: 404, description: CONFIRMATION_NOT_FOUND })
  view(@Param("token") token: string) {
    return this.newsletter.view(token);
  }

  @Post("newsletter/:token")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowSeconds: 600, keyPrefix: "public-newsletter-confirm" })
  @ApiOperation({ summary: "Confirmar la suscripción", description: "Con un clic (no al abrir el enlace). Idempotente." })
  @ApiZodResponse(200, publicNewsletterConfirmationResponse, "Suscripción confirmada.")
  @ApiResponse({ status: 404, description: CONFIRMATION_NOT_FOUND })
  @ApiResponse({ status: 410, description: "`NEWSLETTER_CONFIRMATION_EXPIRED`: el enlace venció." })
  confirm(@Param("token") token: string) {
    return this.newsletter.confirm(token);
  }
}

/** Resumen para el panel (Campañas): cualquier miembro activo lo ve, igual que las campañas. */
@ApiTags("newsletter")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/newsletter")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard)
export class NewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Get("stats")
  @ApiOperation({ summary: "Suscriptores de la newsletter", description: "Audiencia de campañas, confirmados por doble confirmación, pendientes y nuevos de 30 días." })
  @ApiZodResponse(200, newsletterStatsResponse, "Resumen.")
  stats(@Param("organizationId") organizationId: string) {
    return this.newsletter.stats(organizationId);
  }
}
