import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { SiteBackgroundResponse } from "@impulza/contracts";
import { MediaKind, MediaStatus, Prisma, type PrismaClient, type Site, SiteStatus } from "@impulza/database";
import { parseMediaUrl, type StorageAdapter } from "@impulza/storage";
import {
  BACKGROUND_VIDEOS,
  HOME_PAGE_SLUG,
  imageTonesSchema,
  isOverlayLegible,
  legibleStrengths,
  mediaVariantsSchema,
  resolveSiteBackground,
  siteBackgroundSchema,
  type SiteBackground,
  themeTokensSchema,
} from "@impulza/validation";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { ThemesService, type ThemeView } from "../themes/themes.service.js";
import { PlansService } from "../plans/plans.service.js";
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";
import { STORAGE } from "../../storage/storage.module.js";

@Injectable()
export class SitesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly themesService: ThemesService,
    private readonly plansService: PlansService,
    private readonly revalidateWeb: RevalidateWebService,
    @Inject(STORAGE) private readonly storage: StorageAdapter | null,
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
    // El tema se aplica en vivo (no se publica por versión): la página pública tiene que verlo ya.
    await this.revalidateWeb.revalidateSite(site.id);

    return updated;
  }

  private videoUrl = (key: string): string => (this.storage ? this.storage.publicUrl(key) : key);

  /** Fondo de la página (PP3): lo guardado, lo que pinta el render y los videos curados disponibles. */
  async getSiteBackground(organizationId: string, siteId: string): Promise<SiteBackgroundResponse> {
    const site = await this.getSiteOrThrow(organizationId, siteId);
    const theme = themeTokensSchema.parse((await this.getSiteTheme(organizationId, siteId)).tokens);
    return {
      background: site.background ?? null,
      resolved: resolveSiteBackground(site.background, theme, this.videoUrl),
      // Sin almacenamiento configurado no hay de dónde servir los videos.
      videos: this.storage
        ? BACKGROUND_VIDEOS.map((video) => ({ code: video.code, name: video.name, posterUrl: this.videoUrl(video.posterKey) }))
        : [],
    };
  }

  /**
   * Imagen de fondo: tiene que ser un archivo **listo** de la biblioteca de **esta** organización
   * (ADR-006 §9; una URL externa no se acepta porque no se puede verificar su legibilidad ni se
   * controla si desaparece), y la capa elegida tiene que alcanzar AA sobre sus tonos extremos. Se
   * guarda siempre la URL canónica del archivo (su variante más grande), no la que envió el cliente.
   */
  private async checkImageBackground(organizationId: string, background: Extract<SiteBackground, { kind: "image" }>): Promise<SiteBackground> {
    if (!this.storage) {
      throw new UnprocessableEntityException("La subida de imágenes todavía no está habilitada en esta instalación.");
    }
    const reference = parseMediaUrl(background.image.url, this.storage.publicUrl(""));
    if (!reference) {
      throw new UnprocessableEntityException("Elige una imagen de tu biblioteca de medios.");
    }
    const asset =
      reference.organizationId === organizationId
        ? await this.prisma.mediaAsset.findFirst({
            where: { id: reference.assetId, organizationId, status: MediaStatus.READY, kind: MediaKind.IMAGE },
          })
        : null;
    if (!asset) {
      throw new UnprocessableEntityException("Esa imagen no está disponible en tu biblioteca.");
    }
    const tones = imageTonesSchema.safeParse(asset.tones).data ?? null;
    if (!isOverlayLegible(tones, background.overlay)) {
      throw new UnprocessableEntityException({
        message: "Con esa intensidad el texto no se leería bien sobre esta imagen. Elige una capa más intensa.",
        legibleStrengths: legibleStrengths(tones, background.overlay.tone),
      });
    }
    const variants = mediaVariantsSchema.parse(asset.variants);
    const largest = [...variants].sort((a, b) => b.width - a.width)[0]!;
    return { ...background, image: { url: this.storage.publicUrl(largest.key) } };
  }

  /**
   * Video propio de fondo (PP6): mismas reglas que la imagen — un video **listo** de la biblioteca de
   * **esta** organización, y la capa elegida tiene que alcanzar AA sobre sus tonos, que el worker mide
   * en un cuadro por segundo (no solo en el póster). Se guardan las URLs canónicas del MP4 y del
   * póster más grande, no las que envió el cliente.
   */
  private async checkOwnVideoBackground(
    organizationId: string,
    background: Extract<SiteBackground, { kind: "own_video" }>,
  ): Promise<SiteBackground> {
    if (!this.storage) {
      throw new UnprocessableEntityException("Los videos de fondo todavía no están disponibles en esta instalación.");
    }
    const reference = parseMediaUrl(background.video.src, this.storage.publicUrl(""));
    const asset =
      reference && reference.organizationId === organizationId
        ? await this.prisma.mediaAsset.findFirst({
            where: { id: reference.assetId, organizationId, status: MediaStatus.READY, kind: MediaKind.VIDEO },
          })
        : null;
    if (!asset) {
      throw new UnprocessableEntityException("Ese video no está disponible en tu biblioteca.");
    }
    const tones = imageTonesSchema.safeParse(asset.tones).data ?? null;
    if (!isOverlayLegible(tones, background.overlay)) {
      throw new UnprocessableEntityException({
        message: "Con esa intensidad el texto no se leería bien sobre este video. Elige una capa más intensa.",
        legibleStrengths: legibleStrengths(tones, background.overlay.tone),
      });
    }
    const variants = mediaVariantsSchema.parse(asset.variants);
    const video = variants.find((variant) => variant.key.endsWith(".mp4"));
    const poster = variants.filter((variant) => !variant.key.endsWith(".mp4")).sort((a, b) => b.width - a.width)[0];
    if (!video || !poster) {
      throw new UnprocessableEntityException("Ese video no está disponible en tu biblioteca.");
    }
    return {
      ...background,
      video: { src: this.storage.publicUrl(video.key), posterUrl: this.storage.publicUrl(poster.key) },
    };
  }

  /**
   * Cambia el fondo (o vuelve al del tema con `null`). Mismo permiso que aplicar un tema
   * (`site.update`), queda auditado, y la página pública se actualiza de inmediato.
   */
  async setSiteBackground(organizationId: string, actorId: string, siteId: string, input: unknown): Promise<SiteBackgroundResponse> {
    const site = await this.getSiteOrThrow(organizationId, siteId);

    let background: SiteBackground | null = null;
    if (input !== null) {
      const parsed = siteBackgroundSchema.safeParse(input);
      if (!parsed.success) {
        throw new UnprocessableEntityException({
          message: "El fondo no es válido.",
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        });
      }
      background =
        parsed.data.kind === "image"
          ? await this.checkImageBackground(organizationId, parsed.data)
          : parsed.data.kind === "own_video"
            ? await this.checkOwnVideoBackground(organizationId, parsed.data)
            : parsed.data;
      if (background.kind === "video" && !this.storage) {
        throw new UnprocessableEntityException("Los videos de fondo todavía no están disponibles en esta instalación.");
      }
    }

    await this.prisma.site.update({
      where: { id: site.id },
      data: { background: background === null ? Prisma.DbNull : (background as Prisma.InputJsonValue) },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "site.background_changed",
      targetType: "Site",
      targetId: site.id,
      metadata: {
        from: (site.background as { kind?: string } | null)?.kind ?? null,
        to: background?.kind ?? null,
      },
    });
    await this.revalidateWeb.revalidateSite(site.id);

    return this.getSiteBackground(organizationId, siteId);
  }
}
