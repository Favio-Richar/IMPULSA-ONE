import { Body, Controller, Get, Param, Put, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { digitalCardAdminResponse } from "@impulza/contracts";
import { PERMISSIONS } from "@impulza/database";
import { digitalCardSchema, type DigitalCardDto } from "@impulza/validation";
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
import { DigitalCardService } from "./digital-card.service.js";

const uuid = new ZodValidationPipe(uuidParamSchema);

/** Tarjeta digital del sitio desde el panel (F10.4). Permiso `site.update`. */
@ApiTags("digital-card")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/digital-card")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, PermissionGuard, RateLimitGuard)
export class DigitalCardController {
  constructor(private readonly cards: DigitalCardService) {}

  @Get()
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "digital-card-get" })
  @ApiOperation({ summary: "Tarjeta digital del sitio", description: "`card` es `null` mientras no se haya creado. Incluye la dirección pública y qué pases de wallet están disponibles." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodResponse(200, digitalCardAdminResponse, "La tarjeta y su estado.")
  @ApiResponse({ status: 404, description: "Sitio no encontrado en esta organización." })
  @ApiRateLimited(120, 60)
  get(@Param("organizationId") organizationId: string, @Param("siteId", uuid) siteId: string) {
    return this.cards.get(organizationId, siteId);
  }

  @Put()
  @RequirePermission(PERMISSIONS.SITE_UPDATE)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "digital-card-save" })
  @ApiOperation({ summary: "Crear o actualizar la tarjeta digital", description: "Una por sitio. Mientras `enabled` sea falso, la página pública, la vCard y los pases responden 404." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodBody(digitalCardSchema)
  @ApiZodResponse(200, digitalCardAdminResponse, "La tarjeta guardada.")
  @ApiResponse({ status: 404, description: "Sitio no encontrado en esta organización." })
  @ApiRateLimited(60, 60)
  save(
    @Param("organizationId") organizationId: string,
    @Param("siteId", uuid) siteId: string,
    @Body(new ZodValidationPipe(digitalCardSchema)) body: DigitalCardDto,
    @Req() req: RequestWithMembership,
  ) {
    return this.cards.save(organizationId, siteId, req.user.id, body);
  }
}
