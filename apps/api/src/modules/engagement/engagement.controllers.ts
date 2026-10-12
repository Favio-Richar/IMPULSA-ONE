import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Req, Res, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { publicEngagementResponse, siteEngagementResponse } from "@impulza/contracts";
import type { Request, Response } from "express";
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
  ApiZodResponse,
} from "../../openapi/zod-openapi.js";
import { uuidParamSchema } from "../admin/dto/admin-queries.dto.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { OrganizationMembershipGuard } from "../organizations/guards/organization-membership.guard.js";
import { EngagementService } from "./engagement.service.js";

const uuid = new ZodValidationPipe(uuidParamSchema);

/**
 * Vistas y «me gusta» de una página pública (F10). Sin sesión: `CsrfGuard` exige la cabecera propia (que `apps/web` agrega
 * al pedir en nombre del visitante) y el límite de tasa es por visitante. Nunca se cachea: depende de quién pregunta.
 */
@ApiTags("public-engagement")
@Controller("public/sites/:siteSlug/pages/:pageSlug/engagement")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicEngagementController {
  constructor(private readonly engagement: EngagementService) {}

  private noStore(res: Response): void {
    res.setHeader("Cache-Control", "no-store");
  }

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "engagement-read" })
  @ApiOperation({ summary: "Vistas y «me gusta» de una página", description: "Cifras públicas y si este visitante ya dio «me gusta». Solo páginas publicadas y públicas. Sin caché." })
  @ApiZodResponse(200, publicEngagementResponse, "Cifras de la página.")
  @ApiResponse({ status: 404, description: "La página no existe o no está publicada." })
  @ApiRateLimited(120, 60)
  async read(@Param("siteSlug") siteSlug: string, @Param("pageSlug") pageSlug: string, @Req() request: Request, @Res({ passthrough: true }) res: Response) {
    this.noStore(res);
    return this.engagement.read(siteSlug, pageSlug, request);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "engagement-like" })
  @ApiOperation({ summary: "Dar «me gusta» a una página", description: "Uno por visitante y página; repetirlo no cambia nada. No se guarda la IP." })
  @ApiZodResponse(200, publicEngagementResponse, "Cifras actualizadas.")
  @ApiResponse({ status: 404, description: "La página no existe o no está publicada." })
  @ApiRateLimited(30, 60)
  async like(@Param("siteSlug") siteSlug: string, @Param("pageSlug") pageSlug: string, @Req() request: Request, @Res({ passthrough: true }) res: Response) {
    this.noStore(res);
    return this.engagement.like(siteSlug, pageSlug, request);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowSeconds: 60, keyPrefix: "engagement-like" })
  @ApiOperation({ summary: "Quitar el «me gusta» de una página" })
  @ApiZodResponse(200, publicEngagementResponse, "Cifras actualizadas.")
  @ApiResponse({ status: 404, description: "La página no existe o no está publicada." })
  @ApiRateLimited(30, 60)
  async unlike(@Param("siteSlug") siteSlug: string, @Param("pageSlug") pageSlug: string, @Req() request: Request, @Res({ passthrough: true }) res: Response) {
    this.noStore(res);
    return this.engagement.unlike(siteSlug, pageSlug, request);
  }
}

/** Panel: vistas y «me gusta» de cada página del sitio. Lectura para cualquier miembro de la organización, como la analítica. */
@ApiTags("engagement")
@ApiCookieAuth(SESSION_AUTH)
@ApiOrganizationIdParam()
@ApiOrganizationScopedErrors()
@Controller("organizations/:organizationId/sites/:siteId/engagement")
@UseGuards(CsrfGuard, SessionAuthGuard, OrganizationMembershipGuard, RateLimitGuard)
export class SiteEngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Get()
  @RateLimit({ limit: 120, windowSeconds: 60, keyPrefix: "site-engagement" })
  @ApiOperation({ summary: "Vistas y «me gusta» por página", description: "Cifras acumuladas de cada página del sitio y sus totales." })
  @ApiUuidParam("siteId", "Sitio.")
  @ApiZodResponse(200, siteEngagementResponse, "Cifras por página.")
  @ApiRateLimited(120, 60)
  list(@Param("organizationId") organizationId: string, @Param("siteId", uuid) siteId: string) {
    return this.engagement.forSite(organizationId, siteId);
  }
}
