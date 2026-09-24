import { Body, Controller, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CLIENT_EVENT_TYPES } from "@impulza/analytics";
import type { PrismaClient } from "@impulza/database";
import { utmSchema } from "@impulza/validation";
import type { Request } from "express";
import { z } from "zod";
import { CsrfGuard } from "../../common/csrf.guard.js";
import { RateLimit } from "../../common/rate-limit.decorator.js";
import { RateLimitGuard } from "../../common/rate-limit.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ApiZodBody } from "../../openapi/zod-openapi.js";
import { PRISMA } from "../../database/prisma.module.js";
import { AnalyticsService } from "../analytics/analytics.service.js";
import { pageContentSnapshotSchema } from "../pages/page-content-snapshot.js";

// Solo los tipos que el propio navegador del visitante puede disparar. "form_submit",
// "lead_created", "short_link_click" y "qr_visit" nacen del lado del servidor (F3.2/F3.5/F3.6) y no
// se aceptan desde acá: si no, cualquiera podría fabricar leads en el dashboard de otro negocio.
const recordEventSchema = z.object({
  type: z.enum(CLIENT_EVENT_TYPES),
  // Generado por el navegador una vez por evento; un reintento de red reenvía el mismo id y el
  // pipeline lo cuenta una sola vez (idempotencia, F3.6).
  eventId: z.uuid().optional(),
  // Dónde ocurrió. Nunca ids internos (el contrato público de F2.7 no los expone): slug de la
  // página y posición del bloque en la versión publicada; la API resuelve el id real.
  pageSlug: z.string().trim().min(1).max(120).optional(),
  blockPosition: z.number().int().min(0).max(1000).optional(),
  utm: utmSchema.optional(),
});
type RecordEventBody = z.infer<typeof recordEventSchema>;

/**
 * Eventos de analítica que dispara el propio navegador del visitante (F3.4, ampliado en F3.6) —
 * mismo criterio de "sin sesión, sin guards de organización" que `PublicFormsController`.
 * `CsrfGuard` sí aplica: es una escritura real, aunque solo sea un contador.
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
      "`page_view`, `block_click` o `whatsapp_click`. Se encola y lo procesa el worker (F3.6). Sin datos personales: el visitante se anonimiza con un hash rotado por sitio/día (ADR-004 punto 1), nunca se guarda su IP cruda, y el tráfico de bots conocidos se descarta sin persistir nada (ADR-004 punto 2) — responde 204 igual, para no enseñarle a un bot cómo evitar el filtro.",
  })
  @ApiZodBody(recordEventSchema)
  @ApiResponse({ status: 204, description: "Evento aceptado (o descartado por ser de un bot)." })
  @ApiResponse({ status: 400, description: "Tipo fuera del allowlist, o cuerpo inválido." })
  @ApiResponse({ status: 404, description: "Sitio no encontrado, o archivado." })
  @ApiResponse({ status: 429, description: "Límite de peticiones superado (60 por minuto y visitante)." })
  async record(
    @Param("siteSlug") siteSlug: string,
    @Body(new ZodValidationPipe(recordEventSchema)) body: RecordEventBody,
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
      subjectId: await this.resolveSubjectId(body, site.id),
      utm: body.utm ?? null,
      idempotencyKey: body.eventId ? `${body.type}:${site.id}:${body.eventId}` : null,
    });
  }

  /**
   * Página (page_view) o bloque (clics) al que se refiere el evento, resuelto siempre contra lo que
   * existe de verdad en este sitio. Lo que no se puede resolver (slug inventado, posición fuera de
   * rango, página publicada antes de F3.6 sin ids en su versión) cuenta igual en el total del tipo,
   * solo sin atribución: así nadie puede crear filas de agregado nuevas con valores inventados.
   */
  private async resolveSubjectId(body: RecordEventBody, siteId: string): Promise<string | null> {
    if (!body.pageSlug) {
      return null;
    }
    const page = await this.prisma.page.findFirst({
      where: { siteId, slug: body.pageSlug, deletedAt: null },
      select: { id: true },
    });
    if (!page) {
      return null;
    }
    if (body.type === "page_view") {
      return page.id;
    }
    if (body.blockPosition === undefined) {
      return null;
    }

    // La versión publicada, no los bloques vivos: el visitante hizo clic en lo publicado, y
    // `position` se refiere a esa versión (el borrador puede estar reordenado).
    const version = await this.prisma.pageVersion.findFirst({
      where: { pageId: page.id },
      orderBy: { versionNumber: "desc" },
      select: { contentSnapshot: true },
    });
    const snapshot = version ? pageContentSnapshotSchema.safeParse(version.contentSnapshot) : null;
    if (!snapshot?.success) {
      return null;
    }
    return snapshot.data.blocks.find((block) => block.position === body.blockPosition)?.id ?? null;
  }
}
