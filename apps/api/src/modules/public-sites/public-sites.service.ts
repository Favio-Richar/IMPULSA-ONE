import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@impulza/database";
import type { StorageAdapter } from "@impulza/storage";
import {
  abVariantSchema,
  isAbTestBlockType,
  smartCtaSchema,
  weeklyHoursSchema,
  type PublicSmartCtaRule,
  type WeeklyHours,
  backgroundForDisplay,
  isPrimaryActionBlockType,
  parseStoredBlock,
  resolveSiteBackground,
  type ResolvedSiteBackground,
  themeTokensSchema,
} from "@impulza/validation";
import { STORAGE } from "../../storage/storage.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { pageContentSnapshotSchema } from "../pages/page-content-snapshot.js";
import { ThemesService } from "../themes/themes.service.js";
import { resolveSeo, type ResolvedSeo } from "./seo-resolver.js";
import { ACTIVE_ORGANIZATION } from "../../common/active-organization.js";

export interface PublicSiteView {
  name: string;
  slug: string;
  theme: { tokens: unknown };
  background: ResolvedSiteBackground | null;
  pages: Array<{ slug: string; isHome: boolean; publishedAt: Date }>;
}

export interface PublicBlockView {
  position: number;
  type: string;
  config: unknown;
  primary: boolean;
  /** Prueba A/B en curso (F6.5): clave pública y cambios de B, sin nada interno. */
  experiment?: { key: string; variantB: Record<string, unknown> };
}

export interface PublicPageView {
  slug: string;
  isHome: boolean;
  seo: ResolvedSeo;
  blocks: PublicBlockView[];
  /** Smart CTA (F6.6): reglas por posición publicada y horario del sitio. */
  smartCta?: { rules: PublicSmartCtaRule[]; hours: { timeZone: string; weeklyHours: WeeklyHours } | null };
}

const SITE_NOT_FOUND = "Sitio no encontrado.";
const PAGE_NOT_FOUND = "Página no encontrada.";

/**
 * Resuelve lo que ve un visitante sin sesión (F2.7): sitio y página por slug, **solo** contenido
 * publicado. A diferencia de todos los demás servicios de esta API, no recibe `organizationId` —
 * un visitante no tiene uno. El aislamiento acá no es "no cruzar de una organización a otra", es
 * "no mostrar nada que no se haya publicado explícitamente", que es la misma disciplina aplicada a
 * un eje distinto.
 */
@Injectable()
export class PublicSitesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly themesService: ThemesService,
    @Inject(STORAGE) private readonly storage: StorageAdapter | null,
  ) {}

  /**
   * Un sitio es alcanzable si existe y no está archivado. `ARCHIVED` es, desde F2.2, el apagador
   * de un sitio completo ("deja de estar publicado"); no existe un estado "publicado" aparte que
   * activar — publicar es, siempre, una acción sobre una página (F2.6). Un sitio recién creado
   * (`DRAFT`, nunca tocado) igual es alcanzable en cuanto tiene al menos una página publicada: no
   * hay ningún interruptor de "sitio completo" que nadie pidió en el backlog.
   */
  private async getReachableSiteOrThrow(siteSlug: string) {
    const site = await this.prisma.site.findFirst({
      where: { slug: siteSlug, status: { not: "ARCHIVED" }, ...ACTIVE_ORGANIZATION },
    });

    if (!site) {
      throw new NotFoundException(SITE_NOT_FOUND);
    }

    return site;
  }

  async getSite(siteSlug: string): Promise<PublicSiteView> {
    const site = await this.getReachableSiteOrThrow(siteSlug);

    // Mismo cómputo que `SitesService.getSiteTheme` para la API autenticada: un sitio sin tema
    // elegido no queda "sin apariencia", cae al del catálogo por defecto (F2.5).
    const theme = site.themeId
      ? await this.themesService.getTheme(site.organizationId, site.themeId)
      : await this.themesService.getTheme(
          site.organizationId,
          (await this.themesService.getDefaultTheme()).id,
        );

    // Solo la navegación: `PUBLIC` y con al menos una versión publicada. Una página `HIDDEN`
    // sigue siendo alcanzable por enlace directo (F2.3) — por eso esto NO es el filtro que decide
    // si una página existe, solo el de qué aparece en el menú (y, desde F2.8, de qué entra en
    // `sitemap.xml`: mismo criterio, "públicas y publicadas").
    const navPages = await this.prisma.page.findMany({
      where: { siteId: site.id, deletedAt: null, visibility: "PUBLIC", status: "PUBLISHED" },
      orderBy: { position: "asc" },
      select: {
        slug: true,
        isHome: true,
        // `lastmod` real de F2.8: cuándo se publicó la versión vigente, no cuándo se editó el
        // borrador por última vez (eso puede ser mucho más reciente que lo que el público ve).
        versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { publishedAt: true } },
      },
    });

    return {
      name: site.name,
      slug: site.slug,
      theme: { tokens: theme.tokens },
      // Ya resuelto (PP3): el render no decide nada, solo pinta. Un fondo que dejó de ser válido
      // (un video retirado de la biblioteca) cae al del tema en vez de romper la página.
      // PL2: sin fondo propio, el sugerido por el tema (los oscuros van con degradado oscuro).
      background: resolveSiteBackground(backgroundForDisplay(site.background, theme.code), themeTokensSchema.parse(theme.tokens), (key) =>
        this.storage ? this.storage.publicUrl(key) : key,
      ),
      pages: navPages.map((page) => ({
        slug: page.slug,
        isHome: page.isHome,
        publishedAt: page.versions[0]?.publishedAt ?? new Date(0),
      })),
    };
  }

  async getPage(siteSlug: string, pageSlug: string): Promise<PublicPageView> {
    const site = await this.getReachableSiteOrThrow(siteSlug);

    const page = await this.prisma.page.findFirst({
      where: { siteId: site.id, slug: pageSlug, deletedAt: null },
    });

    if (!page) {
      throw new NotFoundException(PAGE_NOT_FOUND);
    }

    // "Publicada" significa, exactamente, tener al menos una versión (F2.6). Un borrador —
    // incluida una página que nunca se publicó— no tiene fila en `PageVersion` y por lo tanto no
    // tiene nada que mostrar acá: ni adivinando el slug exacto hay contenido que filtrar.
    const version = await this.prisma.pageVersion.findFirst({
      where: { pageId: page.id },
      orderBy: { versionNumber: "desc" },
    });

    if (!version) {
      throw new NotFoundException(PAGE_NOT_FOUND);
    }

    const snapshot = pageContentSnapshotSchema.parse(version.contentSnapshot);
    const now = Date.now();
    const experiments = await this.runningExperiments(page.id);

    const blocks = snapshot.blocks
      .filter((block) => {
        if (!block.visible) {
          return false;
        }
        if (block.scheduledStart && now < Date.parse(block.scheduledStart)) {
          return false;
        }
        if (block.scheduledEnd && now > Date.parse(block.scheduledEnd)) {
          return false;
        }
        return true;
      })
      // Se vuelve a resolver contra el catálogo **actual**, no se confía en que lo guardado siga
      // siendo válido: un tipo que existía al publicar puede haber quedado obsoleto, o el esquema
      // de ese tipo pudo subir de versión desde entonces (F2.4). Un bloque degradado se omite acá
      // — la página pública nunca muestra un hueco roto, solo un bloque de menos.
      .map((block) => {
        const parsed = parseStoredBlock(block.type, block.configSchemaVersion, block.config);
        if (!parsed.renderable) {
          return null;
        }
        // PP5: se vuelve a exigir que sea un bloque de acción — el snapshot no se da por bueno.
        const primary = block.isPrimary === true && isPrimaryActionBlockType(block.type);
        const experiment = block.id ? experiments.get(block.id) : undefined;
        const view: PublicBlockView = { position: block.position, type: block.type, config: parsed.config, primary };
        if (experiment && experiment.blockType === block.type) {
          view.experiment = { key: experiment.key, variantB: experiment.variantB };
        }
        return view;
      })
      .filter((block): block is PublicBlockView => block !== null);

    const canonicalOverridePath = await this.resolveCanonicalOverride(site.id, site.slug, snapshot.seoMeta);
    const smartCta = await this.resolveSmartCta(site.id, page.smartCta, snapshot.blocks, blocks);

    return {
      ...(smartCta ? { smartCta } : {}),
      slug: page.slug,
      isHome: page.isHome,
      seo: resolveSeo({
        site: { name: site.name },
        page: { slug: page.slug, isHome: page.isHome },
        seoMeta: snapshot.seoMeta,
        blocks,
        canonicalOverridePath,
        selfPath: this.publicPath(site.slug, page),
      }),
      blocks,
    };
  }

  /**
   * Smart CTA (F6.6): reglas guardadas (revalidadas al leer) traducidas a la posición publicada del
   * bloque. Una regla cuyo bloque no está en lo que ve el visitante (oculto, no publicado, degradado
   * o que ya no es de acción) se omite. Con el horario del sitio (el de reservas) para "fuera de
   * horario". Sin reglas aplicables, `null`.
   */
  private async resolveSmartCta(
    siteId: string,
    stored: unknown,
    snapshotBlocks: Array<{ id?: string; position: number }>,
    visible: PublicBlockView[],
  ): Promise<PublicPageView["smartCta"] | null> {
    const parsed = smartCtaSchema.safeParse(stored ?? { rules: [] });
    if (!parsed.success || parsed.data.rules.length === 0) {
      return null;
    }
    const actionPositions = new Set(visible.filter((block) => isPrimaryActionBlockType(block.type)).map((block) => block.position));
    const positionById = new Map(snapshotBlocks.filter((block) => block.id).map((block) => [block.id!, block.position]));
    const rules = parsed.data.rules
      .map((rule) => ({ condition: rule.condition, position: positionById.get(rule.blockId) }))
      .filter((rule): rule is PublicSmartCtaRule => rule.position !== undefined && actionPositions.has(rule.position));
    if (rules.length === 0) {
      return null;
    }
    const settings = await this.prisma.bookingSettings.findUnique({ where: { siteId }, select: { timeZone: true, weeklyHours: true } });
    const weeklyHours = settings ? weeklyHoursSchema.safeParse(settings.weeklyHours) : null;
    return {
      rules,
      hours: settings && weeklyHours?.success ? { timeZone: settings.timeZone, weeklyHours: weeklyHours.data } : null,
    };
  }

  /**
   * Pruebas A/B en curso de la página por bloque (F6.5, ADR-011). La variante B se vuelve a validar
   * al leer, igual que la configuración de cada bloque: lo guardado no se da por bueno.
   */
  private async runningExperiments(pageId: string): Promise<Map<string, { key: string; blockType: string; variantB: Record<string, unknown> }>> {
    const tests = await this.prisma.abTest.findMany({
      where: { pageId, status: "RUNNING" },
      select: { blockId: true, key: true, blockType: true, variantB: true },
    });
    const byBlock = new Map<string, { key: string; blockType: string; variantB: Record<string, unknown> }>();
    for (const test of tests) {
      if (!isAbTestBlockType(test.blockType)) {
        continue;
      }
      const variantB = abVariantSchema(test.blockType).safeParse(test.variantB);
      if (variantB.success) {
        byBlock.set(test.blockId, { key: test.key, blockType: test.blockType, variantB: variantB.data as Record<string, unknown> });
      }
    }
    return byBlock;
  }

  private publicPath(siteSlug: string, page: { slug: string; isHome: boolean }): string {
    return page.isHome ? `/${siteSlug}` : `/${siteSlug}/${page.slug}`;
  }

  /**
   * Resuelve `seoMeta.canonicalPageSlug` a una ruta pública real, o `null` si no hay override (el
   * caso normal) o si quedó huérfano: apunta a una página que ya no existe, se borró o se
   * despublicó desde que se guardó. Un canonical roto sería peor que no tener override — mejor
   * caer de vuelta a la ruta propia en silencio que servir un `<link rel="canonical">` a un 404.
   */
  private async resolveCanonicalOverride(
    siteId: string,
    siteSlug: string,
    seoMeta: { canonicalPageSlug?: string | null } | null,
  ): Promise<string | null> {
    const targetSlug = seoMeta?.canonicalPageSlug;
    if (!targetSlug) {
      return null;
    }

    const target = await this.prisma.page.findFirst({
      where: { siteId, slug: targetSlug, deletedAt: null, status: "PUBLISHED" },
      select: { slug: true, isHome: true },
    });

    return target ? this.publicPath(siteSlug, target) : null;
  }
}
