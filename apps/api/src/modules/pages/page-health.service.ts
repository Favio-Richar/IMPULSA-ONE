import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@impulza/database";
import { evaluatePageHealth, type PageHealthReport } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { ThemesService } from "../themes/themes.service.js";
import { PageVersionsService } from "./page-versions.service.js";

/**
 * Salud de página (F6.1). Reúne el estado **real** de la página (bloques vivos con su última
 * configuración, SEO, tema efectivo, formularios/servicios/productos que referencia) y lo evalúa con
 * `evaluatePageHealth`, la misma función pura que prueban los tests de `@impulza/validation`. El
 * panel nunca calcula el puntaje por su cuenta.
 *
 * Solo lee datos de la organización del contexto: cada consulta filtra por el sitio ya verificado
 * dentro de `organizationId` (ADR-002).
 */
@Injectable()
export class PageHealthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly themesService: ThemesService,
    private readonly pageVersionsService: PageVersionsService,
  ) {}

  async getHealth(organizationId: string, siteId: string, pageId: string): Promise<PageHealthReport & { checkedAt: Date }> {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, siteId, deletedAt: null, site: { organizationId } },
      include: { site: { select: { themeId: true } } },
    });
    if (!page) {
      throw new NotFoundException("Página no encontrada.");
    }

    const [blocks, forms, services, products, publishedPages, hasUnpublishedChanges, themeTokens] = await Promise.all([
      this.prisma.block.findMany({
        where: { pageId },
        orderBy: { position: "asc" },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { config: true } } },
      }),
      this.prisma.form.findMany({ where: { siteId }, select: { id: true } }),
      this.prisma.bookableService.findMany({ where: { siteId, organizationId, active: true }, select: { id: true } }),
      this.prisma.product.findMany({ where: { siteId, organizationId, active: true }, select: { id: true, categoryId: true } }),
      this.prisma.page.findMany({ where: { siteId, deletedAt: null, status: "PUBLISHED" }, select: { slug: true } }),
      this.pageVersionsService.hasUnpublishedChanges(organizationId, siteId, pageId),
      this.resolveThemeTokens(organizationId, page.site.themeId),
    ]);

    const checkedAt = new Date();
    const report = evaluatePageHealth({
      page: {
        isHome: page.isHome,
        status: page.status,
        visibility: page.visibility,
        seoMeta: page.seoMeta,
        hasUnpublishedChanges,
      },
      blocks: blocks.map((block) => ({
        id: block.id,
        type: block.type,
        configSchemaVersion: block.configSchemaVersion,
        visible: block.visible,
        isPrimary: block.isPrimary,
        scheduledEnd: block.scheduledEnd,
        config: block.versions[0]?.config ?? null,
      })),
      themeTokens,
      resources: {
        existingFormIds: new Set(forms.map((form) => form.id)),
        activeServiceIds: new Set(services.map((service) => service.id)),
        activeProducts: products,
        publishedPageSlugs: new Set(publishedPages.map((row) => row.slug)),
      },
      now: checkedAt,
    });

    // Telemetría: puntaje y cantidad por severidad, nunca contenido de la página.
    logger.info("salud de página evaluada", {
      organizationId,
      pageId,
      score: report.score,
      critical: report.findings.filter((finding) => finding.severity === "critical").length,
      warning: report.findings.filter((finding) => finding.severity === "warning").length,
    });

    return { ...report, checkedAt };
  }

  private async resolveThemeTokens(organizationId: string, themeId: string | null): Promise<unknown> {
    if (themeId) {
      return (await this.themesService.getTheme(organizationId, themeId)).tokens;
    }
    return (await this.themesService.getDefaultTheme()).tokens;
  }
}
