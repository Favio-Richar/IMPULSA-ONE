import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type Page, type PageVisibility, type PrismaClient } from "@impulza/database";
import type { SeoMeta } from "@impulza/validation";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { PlansService } from "../plans/plans.service.js";

@Injectable()
export class PagesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly plansService: PlansService,
  ) {}

  /**
   * Verifica en una sola consulta que el sitio exista **y** sea de la organización del contexto.
   * El guard de membresía prueba que el usuario pertenece a `organizationId`, no que el sitio sea
   * suyo: sin esto, un miembro de A podría gestionar las páginas de un sitio de B (ataque de id
   * cruzado, F1.9/F2.2). 404 en vez de 403 para no confirmar que el sitio ajeno existe.
   */
  private async assertSiteInOrganization(organizationId: string, siteId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId },
      select: { id: true },
    });

    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
  }

  /** Igual que arriba, pero para una página: valida toda la cadena organización → sitio → página. */
  private async getPageOrThrow(
    organizationId: string,
    siteId: string,
    pageId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<Page> {
    const page = await this.prisma.page.findFirst({
      where: {
        id: pageId,
        siteId,
        site: { organizationId },
        ...(options.includeDeleted ? {} : { deletedAt: null }),
      },
    });

    if (!page) {
      throw new NotFoundException("Página no encontrada.");
    }

    return page;
  }

  async listPages(organizationId: string, siteId: string): Promise<Page[]> {
    await this.assertSiteInOrganization(organizationId, siteId);

    return this.prisma.page.findMany({
      where: { siteId, deletedAt: null },
      orderBy: { position: "asc" },
    });
  }

  async getPage(organizationId: string, siteId: string, pageId: string): Promise<Page> {
    return this.getPageOrThrow(organizationId, siteId, pageId);
  }

  async createPage(
    organizationId: string,
    actorId: string,
    siteId: string,
    slug: string,
    visibility?: PageVisibility,
  ): Promise<Page> {
    await this.assertSiteInOrganization(organizationId, siteId);

    let page: Page;
    try {
      page = await this.prisma.$transaction(async (tx) => {
        await this.plansService.assertWithinLimit(tx, organizationId, "pagesPerSite", siteId);
        // La posición se calcula dentro de la transacción para que dos creaciones simultáneas no
        // lean el mismo máximo. Compartir posición no rompe nada (no hay UNIQUE), solo desordena.
        const last = await tx.page.findFirst({
          where: { siteId, deletedAt: null },
          orderBy: { position: "desc" },
          select: { position: true },
        });

        return tx.page.create({
          data: {
            siteId,
            slug,
            position: (last?.position ?? -1) + 1,
            ...(visibility === undefined ? {} : { visibility }),
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Ya existe una página con ese slug en este sitio.");
      }
      throw error;
    }

    await this.auditService.record({
      organizationId,
      actorId,
      action: "page.created",
      targetType: "Page",
      targetId: page.id,
      metadata: { siteId, slug: page.slug },
    });

    return page;
  }

  async updatePage(
    organizationId: string,
    actorId: string,
    siteId: string,
    pageId: string,
    changes: { slug?: string; visibility?: PageVisibility; seoMeta?: SeoMeta | null },
  ): Promise<Page> {
    const page = await this.getPageOrThrow(organizationId, siteId, pageId);

    // El slug de la home es fijo: no aparece en la URL pública (se sirve en la raíz del sitio) y
    // renombrarlo solo abriría la puerta a que otra página ocupe ese nombre.
    if (page.isHome && changes.slug !== undefined && changes.slug !== page.slug) {
      throw new BadRequestException("La página de inicio no se puede renombrar.");
    }

    let updated: Page;
    try {
      updated = await this.prisma.page.update({
        where: { id: page.id },
        data: {
          ...(changes.slug === undefined ? {} : { slug: changes.slug }),
          ...(changes.visibility === undefined ? {} : { visibility: changes.visibility }),
          // `Prisma.DbNull`, no `null` a secas: en una columna JSON, `null` llano deja la columna
          // sin tocar (Prisma la interpreta como "no seteado") en vez de guardar un JSON `null`
          // real — mismo caso ya resuelto en `PageVersionsService.restoreVersion` (F2.6).
          ...(changes.seoMeta === undefined
            ? {}
            : { seoMeta: changes.seoMeta === null ? Prisma.DbNull : (changes.seoMeta as Prisma.InputJsonValue) }),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Ya existe una página con ese slug en este sitio.");
      }
      throw error;
    }

    await this.auditService.record({
      organizationId,
      actorId,
      action: "page.updated",
      targetType: "Page",
      targetId: page.id,
      metadata: { siteId, ...changes },
    });

    return updated;
  }

  /**
   * Reordenar recibe el orden completo, no un movimiento relativo: el resultado no depende del
   * orden de llegada de varias peticiones y se puede exigir de una vez que la lista sea
   * exactamente el conjunto de páginas vivas del sitio (ni de más, ni de menos, ni ajenas).
   */
  async reorderPages(
    organizationId: string,
    actorId: string,
    siteId: string,
    pageIds: string[],
  ): Promise<Page[]> {
    await this.assertSiteInOrganization(organizationId, siteId);

    if (new Set(pageIds).size !== pageIds.length) {
      throw new BadRequestException("La lista de páginas tiene identificadores repetidos.");
    }

    const current = await this.prisma.page.findMany({
      where: { siteId, deletedAt: null },
      select: { id: true },
    });
    const currentIds = new Set(current.map((page) => page.id));

    if (pageIds.length !== currentIds.size || pageIds.some((id) => !currentIds.has(id))) {
      throw new BadRequestException("La lista debe incluir exactamente todas las páginas del sitio.");
    }

    await this.prisma.$transaction(
      pageIds.map((id, index) =>
        this.prisma.page.update({ where: { id }, data: { position: index } }),
      ),
    );

    await this.auditService.record({
      organizationId,
      actorId,
      action: "page.reordered",
      targetType: "Site",
      targetId: siteId,
      metadata: { pageIds },
    });

    return this.listPages(organizationId, siteId);
  }

  /**
   * Borrado **lógico**: la fila y todo su historial de versiones siguen ahí. Borrar contenido del
   * usuario de forma irreversible desde un CRUD va contra CLAUDE.md; la purga definitiva es una
   * operación aparte y explícita. El índice único parcial (`WHERE deleted_at IS NULL`) libera el
   * slug para que se pueda volver a usar ese nombre.
   */
  async deletePage(organizationId: string, actorId: string, siteId: string, pageId: string): Promise<Page> {
    const page = await this.getPageOrThrow(organizationId, siteId, pageId);

    if (page.isHome) {
      throw new BadRequestException("La página de inicio no se puede eliminar.");
    }

    const deleted = await this.prisma.page.update({
      where: { id: page.id },
      data: { deletedAt: new Date() },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "page.deleted",
      targetType: "Page",
      targetId: page.id,
      metadata: { siteId, slug: page.slug },
    });

    return deleted;
  }

  async restorePage(organizationId: string, actorId: string, siteId: string, pageId: string): Promise<Page> {
    const page = await this.getPageOrThrow(organizationId, siteId, pageId, { includeDeleted: true });

    if (page.deletedAt === null) {
      return page;
    }

    // Si mientras tanto otra página tomó el slug, restaurar chocaría con el índice parcial: se
    // informa en vez de fallar con un 500, porque es una situación real y esperable.
    let restored: Page;
    try {
      // Restaurar vuelve a ocupar un lugar: respeta el límite de páginas por sitio igual que crear.
      restored = await this.prisma.$transaction(async (tx) => {
        await this.plansService.assertWithinLimit(tx, organizationId, "pagesPerSite", siteId);
        return tx.page.update({
          where: { id: page.id },
          data: { deletedAt: null },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          "Otra página del sitio ya usa ese slug. Renómbrala antes de restaurar esta.",
        );
      }
      throw error;
    }

    await this.auditService.record({
      organizationId,
      actorId,
      action: "page.restored",
      targetType: "Page",
      targetId: page.id,
      metadata: { siteId, slug: page.slug },
    });

    return restored;
  }
}
