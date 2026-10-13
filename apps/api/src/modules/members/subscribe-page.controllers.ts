import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { freeSubscribeResponse, publicSubscribePageResponse, subscribePageAdminResponse } from "@impulza/contracts";
import { PERMISSIONS } from "@impulza/database";
import { freeSubscribeSchema, subscribePageSchema, type FreeSubscribeDto, type SubscribePageDto } from "@impulza/validation";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SESSION_AUTH } from "../../openapi/document.js";
import { ApiOrganizationIdParam, ApiOrganizationScopedErrors, ApiRateLimited, ApiUuidParam, ApiZodBody, ApiZodResponse } from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import type { RequestWithMembership } from "../organizations/request-with-membership.js";
import { PermissionGuard } from "../rbac/permission.guard.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { SubscribePageService } from "./subscribe-page.service.js";

const uuid = new ZodValidationPipe(uuidParamSchema);

/** Página de suscripción del sitio desde el panel. Permiso `member.manage` (el mismo de los planes y los miembros). */
@ApiTags("members")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/subscribe-page")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard, RateLimitGuard)
export class SubscribePageController {
  constructor(private readonly pages: SubscribePageService) {}

  @Get()
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "subscribe-page-get" })
  @ApiOperation({ summary: "Página de suscripción del sitio", description: "`page` es `null` mientras no se haya creado. Incluye la dirección pública." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodResponse(200, subscribePageAdminResponse, "La página y su estado.")
  @ApiResponse({ status: 404, description: "Sitio no encontrado en esta organización." })
  @ApiRateLimited(120, 60)
  get(@Param("organizationId") organizationId: string, @Param("siteId", uuid) siteId: string) {
    return this.pages.get(organizationId, siteId);
  }

  @Put()
  @RequirePermission(PERMISSIONS.MEMBER_MANAGE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "subscribe-page-save" })
  @ApiOperation({ summary: "Crear o actualizar la página de suscripción", description: "Una por sitio. Mientras `enabled` sea falso, la página pública y la suscripción responden 404." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodBody(subscribePageSchema)
  @ApiZodResponse(200, subscribePageAdminResponse, "La página guardada.")
  @ApiResponse({ status: 404, description: "Sitio no encontrado en esta organización." })
  @ApiRateLimited(60, 60)
  save(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Body(new ZodValidationPipe(subscribePageSchema)) body: SubscribePageDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.pages.save(organizationId, siteId, req.user.id, body);
  }
}

/** Página de suscripción pública. Sin sesión. Mientras la página no esté activa, todo responde 404. */
@ApiTags("public-members")
@Controller("public/sites/:siteSlug/subscribe")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicSubscribePageController {
  constructor(private readonly pages: SubscribePageService) {}

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "public-subscribe-page" })
  @ApiOperation({ summary: "Página de suscripción del sitio", description: "Los planes de pago se piden aparte, en `/members/plans`." })
  @ApiZodResponse(200, publicSubscribePageResponse, "La página activa.")
  @ApiResponse({ status: 404, description: "El sitio no existe o su página de suscripción no está activa." })
  @ApiRateLimited(120, 60)
  page(@Param("siteSlug") siteSlug: string) {
    return this.pages.publicView(siteSlug);
  }

  @Post("free")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @RateLimit({ limit: 10, windowSeconds: 600, keyPrefix: "public-subscribe-free" })
  @ApiOperation({
    summary: "Suscribirse gratis",
    description:
      "Crea al suscriptor y le envía su enlace de acceso. Responde lo mismo pase lo que pase (sin enumeración). Límite por IP y por correo; campo trampa.",
  })
  @ApiZodBody(freeSubscribeSchema)
  @ApiZodResponse(200, freeSubscribeResponse, "Solicitud recibida.")
  @ApiResponse({ status: 400, description: "Correo inválido." })
  @ApiResponse({ status: 404, description: "La página no existe, no está activa o no ofrece la suscripción gratuita." })
  @ApiRateLimited(10, 600)
  async free(@Param("siteSlug") siteSlug: string, @Body(new ZodValidationPipe(freeSubscribeSchema)) body: FreeSubscribeDto) {
    await this.pages.subscribeFree(siteSlug, body);
    return { sent: true as const };
  }
}
