import { createHmac } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PublicEngagementResponse, SiteEngagementResponse } from "@impulza/contracts";
import { PageStatus, PageVisibility, type PrismaClient } from "@impulza/database";
import type { Request } from "express";
import { SERVED_SITE } from "../../common/active-organization.js";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { resolveVisitorContext } from "../../common/visitor-context.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";

const NOT_FOUND = "Página no encontrada.";

/**
 * Vistas y «me gusta» públicos de una página (F10).
 *
 * - Las **vistas** las suma el procesador de analítica (misma transacción que el evento): acá solo se leen.
 * - Un **«me gusta»** es por visitante y página. Del visitante no se guarda la IP: la clave es un HMAC con el secreto
 *   interno, y la unicidad en la base impide contarlo dos veces aunque lleguen peticiones simultáneas. El contador
 *   cambia en la misma transacción que crea o borra el «me gusta».
 * - Solo páginas publicadas, públicas y de un sitio servido: nunca se cuenta (ni se revela) nada de un borrador.
 */
@Injectable()
export class EngagementService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private visitorKey(request: Request, pageId: string): string {
    const { ip } = resolveVisitorContext(request);
    return createHmac("sha256", env.INTERNAL_PROXY_SECRET).update(`page-like:${pageId}:${ip}`).digest("hex");
  }

  private async servedPage(siteSlug: string, pageSlug: string) {
    const page = await this.prisma.page.findFirst({
      where: {
        slug: pageSlug,
        deletedAt: null,
        status: PageStatus.PUBLISHED,
        visibility: PageVisibility.PUBLIC,
        site: { slug: siteSlug, ...SERVED_SITE },
      },
      select: { id: true, siteId: true, site: { select: { organizationId: true } } },
    });
    if (!page) throw new NotFoundException(NOT_FOUND);
    return { id: page.id, siteId: page.siteId, organizationId: page.site.organizationId };
  }

  async read(siteSlug: string, pageSlug: string, request: Request): Promise<PublicEngagementResponse> {
    const page = await this.servedPage(siteSlug, pageSlug);
    const [row, liked] = await Promise.all([
      this.prisma.pageEngagement.findUnique({ where: { pageId: page.id }, select: { views: true, likes: true } }),
      this.prisma.pageLike.findUnique({ where: { pageId_visitorKey: { pageId: page.id, visitorKey: this.visitorKey(request, page.id) } }, select: { id: true } }),
    ]);
    return { views: row?.views ?? 0, likes: row?.likes ?? 0, liked: liked !== null };
  }

  /** Idempotente: repetir el «me gusta» no cambia nada. */
  async like(siteSlug: string, pageSlug: string, request: Request): Promise<PublicEngagementResponse> {
    const page = await this.servedPage(siteSlug, pageSlug);
    const visitorKey = this.visitorKey(request, page.id);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.pageLike.create({ data: { pageId: page.id, siteId: page.siteId, organizationId: page.organizationId, visitorKey } });
        await tx.$executeRaw`
          INSERT INTO page_engagement (page_id, site_id, organization_id, views, likes, updated_at)
          VALUES (${page.id}::uuid, ${page.siteId}::uuid, ${page.organizationId}::uuid, 0, 1, now())
          ON CONFLICT (page_id) DO UPDATE SET likes = page_engagement.likes + 1, updated_at = now()`;
      });
    } catch (error) {
      // Ya le había dado «me gusta» (o dos peticiones a la vez): la segunda no suma.
      if (!isUniqueViolation(error)) throw error;
    }
    return this.read(siteSlug, pageSlug, request);
  }

  /** Quitar el «me gusta»; idempotente. */
  async unlike(siteSlug: string, pageSlug: string, request: Request): Promise<PublicEngagementResponse> {
    const page = await this.servedPage(siteSlug, pageSlug);
    const visitorKey = this.visitorKey(request, page.id);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.pageLike.deleteMany({ where: { pageId: page.id, visitorKey } });
      if (removed.count > 0) {
        await tx.$executeRaw`UPDATE page_engagement SET likes = GREATEST(likes - 1, 0), updated_at = now() WHERE page_id = ${page.id}::uuid`;
      }
    });
    return this.read(siteSlug, pageSlug, request);
  }

  /** Panel: cifras de cada página del sitio, acotadas a la organización (ADR-002). */
  async forSite(organizationId: string, siteId: string): Promise<SiteEngagementResponse> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true } });
    if (!site) throw new NotFoundException("Sitio no encontrado.");
    const pages = await this.prisma.page.findMany({
      where: { siteId, deletedAt: null },
      orderBy: { position: "asc" },
      select: { id: true, slug: true, isHome: true, engagement: { select: { views: true, likes: true } } },
    });
    const rows = pages.map((page) => ({ pageId: page.id, slug: page.slug, isHome: page.isHome, views: page.engagement?.views ?? 0, likes: page.engagement?.likes ?? 0 }));
    return {
      pages: rows,
      totals: { views: rows.reduce((sum, row) => sum + row.views, 0), likes: rows.reduce((sum, row) => sum + row.likes, 0) },
    };
  }
}
