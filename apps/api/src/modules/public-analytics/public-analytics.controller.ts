import { Body, Controller, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { PrismaClient } from "@impulza/database";
import type { Request } from "express";
import { z } from "zod";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { PRISMA } from "../../database/prisma.module.js";
import { AnalyticsService } from "../analytics/analytics.service.js";

// Tipos de evento que un visitante puede disparar él mismo desde el navegador — un allowlist
// deliberadamente corto: "page_view"/"form_submit"/"lead_created" ya se generan del lado del
// servidor (F2.7/F3.2) y no tienen por qué aceptarse también desde acá, y "qr_visit" se genera en
// la propia resolución del redirect (F3.5), no con una llamada aparte. Este endpoint crece con
// F3.6 según haga falta, no antes.
const PUBLIC_CLIENT_EVENT_TYPES = ["whatsapp_click"] as const;

const recordEventSchema = z.object({
  type: z.enum(PUBLIC_CLIENT_EVENT_TYPES),
});

/**
 * Eventos de analítica que dispara el propio navegador del visitante (F3.4) — mismo criterio de
 * "sin sesión, sin guards de organización" que `PublicFormsController`. `CsrfGuard` sí aplica: es
 * una escritura real, aunque solo sea un contador.
 */
@ApiTags("public-analytics")
@Controller("public/sites/:siteSlug/events")
@UseGuards(CsrfGuard, RateLimitGuard)
export class PublicAnalyticsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 60, windowSeconds: 60, keyPrefix: "public-analytics-event" })
  @ApiOperation({
    summary: "Registrar un evento de analítica disparado por el visitante",
    description:
      "Por ahora solo `whatsapp_click` (F3.4). Sin datos personales: el visitante se anonimiza con un hash rotado por sitio/día (ADR-004 punto 1), nunca se guarda su IP cruda.",
  })
  @ApiResponse({ status: 204, description: "Evento registrado." })
  @ApiResponse({ status: 404, description: "Sitio no encontrado, o archivado." })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (60 por minuto y IP)." })
  async record(
    @Param("siteSlug") siteSlug: string,
    @Body(new ZodValidationPipe(recordEventSchema)) body: { type: (typeof PUBLIC_CLIENT_EVENT_TYPES)[number] },
    @Req() request: Request,
  ): Promise<void> {
    const site = await this.prisma.site.findFirst({
      where: { slug: siteSlug, status: { not: "ARCHIVED" } },
      select: { id: true, organizationId: true },
    });

    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }

    await this.analyticsService.recordEvent({
      organizationId: site.organizationId,
      siteId: site.id,
      type: body.type,
      request,
    });
  }
}
