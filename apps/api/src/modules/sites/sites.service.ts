import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { type PrismaClient, type Site, SiteStatus } from "@impulza/database";
import { HOME_PAGE_SLUG } from "@impulza/validation";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { ThemesService, type ThemeView } from "../themes/themes.service.js";
import { PlansService } from "../plans/plans.service.js";

@Injectable()
export class SitesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly themesService: ThemesService,
    private readonly plansService: PlansService,
  ) {}

  /**
   * Resuelve un sitio **verificando que pertenezca a la organización del contexto**. El guard de
   * membresía ya probó que el usuario pertenece a `organizationId`, pero no que `siteId` sea de
   * esa organización: sin esta comprobación, un miembro legítimo de A podría tocar un sitio de B
   * pasando su propio organizationId en la URL (mismo ataque de id cruzado cubierto en F1.9).
   * Devuelve 404 y no 403 para no confirmar que el sitio ajeno existe.
   */
  private async getSiteOrThrow(organizationId: string, siteId: string): Promise<Site> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId } });

    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }

    return site;
  }

  /**
   * Un slug público está libre solo si no lo usa otro sitio **y** no lo ocupa una redirección
   * viva: ambas cosas resuelven la misma URL pública, así que compiten por el mismo espacio de
   * nombres. La base de datos garantiza la unicidad dentro de cada tabla; esta regla cruzada solo
   * puede vivir acá. `allowedSiteId` permite que un sitio recupere un slug que él mismo dejó atrás.
   */
  private async assertSlugAvailable(slug: string, allowedSiteId?: string): Promise<void> {
    const existingSite = await this.prisma.site.findUnique({ where: { slug } });
    if (existingSite && existingSite.id !== allowedSiteId) {
      throw new ConflictException("Ese slug ya está en uso.");
    }

    const existingRedirect = await this.prisma.siteSlugRedirect.findUnique({ where: { fromSlug: slug } });
    if (existingRedirect && existingRedirect.siteId !== allowedSiteId) {
      throw new ConflictException("Ese slug ya está en uso.");
    }
  }

  async createSite(organizationId: string, actorId: string, name: string, slug: string): Promise<Site> {
    await this.assertSlugAvailable(slug);

    let site: Site;
    try {
      // La página de inicio se crea en la misma transacción (F2.3): un sitio sin home no es un
      // estado válido del que el usuario pueda salir solo — no existe endpoint para crear *la*
      // home, precisamente porque siempre debe existir.
      site = await this.prisma.$transaction(async (tx) => {
        // Límite de plan (F4.2) dentro de la misma transacción que crea: ver `assertWithinLimit`.
        await this.plansService.assertWithinLimit(tx, organizationId, "sites");
        const created = await tx.site.create({
          data: { organizationId, name, slug, status: SiteStatus.DRAFT },
        });

        await tx.page.create({
          data: { siteId: created.id, slug: HOME_PAGE_SLUG, position: 0, isHome: true },
        });

        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Ese slug ya está en uso.");
      }
      throw error;
    }

    await this.auditService.record({
      organizationId,
      actorId,
      action: "site.created",
      targetType: "Site",
      targetId: site.id,
      metadata: { slug: site.slug },
    });

    return site;
  }

  async listSites(organizationId: string): Promise<Site[]> {
    return this.prisma.site.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
  }

  async getSite(organizationId: string, siteId: string): Promise<Site> {
    return this.getSiteOrThrow(organizationId, siteId);
  }

  async updateSite(
    organizationId: string,
    actorId: string,
    siteId: string,
    changes: { name?: string; slug?: string },
  ): Promise<Site> {
    const site = await this.getSiteOrThrow(organizationId, siteId);
    const slugChanged = changes.slug !== undefined && changes.slug !== site.slug;

    if (slugChanged) {
      await this.assertSlugAvailable(changes.slug as string, site.id);
    }

    // Un sitio que ya estuvo publicado tiene enlaces vivos afuera: cambiarle el slug sin dejar
    // una redirección los rompe en silencio (criterio de F2.2, PM §9.14). Un sitio en borrador
    // nunca fue alcanzable públicamente, así que no genera redirección basura.
    const needsRedirect = slugChanged && site.status === SiteStatus.PUBLISHED;

    let updated: Site;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        if (slugChanged) {
          // El sitio recupera un slug propio que había dejado atrás: se libera esa redirección,
          // que dejaría de tener sentido (apuntaría de un slug a sí mismo).
          await tx.siteSlugRedirect.deleteMany({ where: { fromSlug: changes.slug, siteId: site.id } });
        }

        if (needsRedirect) {
          await tx.siteSlugRedirect.create({ data: { siteId: site.id, fromSlug: site.slug } });
        }

        return tx.site.update({
          where: { id: site.id },
          data: {
            ...(changes.name === undefined ? {} : { name: changes.name }),
            ...(changes.slug === undefined ? {} : { slug: changes.slug }),
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Ese slug ya está en uso.");
      }
      throw error;
    }

    await this.auditService.record({
      organizationId,
      actorId,
      action: "site.updated",
      targetType: "Site",
      targetId: site.id,
      metadata: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(slugChanged ? { slugFrom: site.slug, slugTo: updated.slug, redirectCreated: needsRedirect } : {}),
      },
    });

    return updated;
  }

  async archiveSite(organizationId: string, actorId: string, siteId: string): Promise<Site> {
    const site = await this.getSiteOrThrow(organizationId, siteId);

    // Idempotente: archivar dos veces no genera una segunda entrada de auditoría ni falla.
    if (site.status === SiteStatus.ARCHIVED) {
      return site;
    }

    const archived = await this.prisma.site.update({
      where: { id: site.id },
      data: { status: SiteStatus.ARCHIVED },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "site.archived",
      targetType: "Site",
      targetId: site.id,
      metadata: { slug: site.slug, previousStatus: site.status },
    });

    return archived;
  }

  /**
   * Tema con el que se muestra el sitio: el aplicado, o el del catálogo por defecto si todavía no
   * eligió uno. Nunca devuelve "sin tema" — una página pública siempre tiene apariencia (F2.5).
   */
  async getSiteTheme(organizationId: string, siteId: string): Promise<ThemeView & { isDefault: boolean }> {
    const site = await this.getSiteOrThrow(organizationId, siteId);

    if (site.themeId === null) {
      const fallback = await this.themesService.getDefaultTheme();
      return { ...(await this.themesService.getTheme(organizationId, fallback.id)), isDefault: true };
    }

    return { ...(await this.themesService.getTheme(organizationId, site.themeId)), isDefault: false };
  }

  /**
   * Aplica un tema al sitio, o lo devuelve al del catálogo por defecto con `null`.
   *
   * Aplicar un tema es configuración del sitio (`site.update`), no autoría de temas
   * (`theme.manage`): un EDITOR puede cambiar de apariencia sin poder inventar paletas nuevas.
   * `assertThemeApplicable` es lo que impide aplicar el tema de otra organización pasando su id —
   * el guard de membresía prueba que el usuario pertenece al tenant, no que el tema sea suyo.
   */
  async setSiteTheme(
    organizationId: string,
    actorId: string,
    siteId: string,
    themeId: string | null,
  ): Promise<Site> {
    const site = await this.getSiteOrThrow(organizationId, siteId);

    if (themeId !== null) {
      await this.themesService.assertThemeApplicable(organizationId, themeId);
    }

    const updated = await this.prisma.site.update({
      where: { id: site.id },
      data: { themeId },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "site.theme_changed",
      targetType: "Site",
      targetId: site.id,
      metadata: { themeFrom: site.themeId, themeTo: themeId },
    });

    return updated;
  }
}
