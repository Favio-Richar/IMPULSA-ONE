import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@impulza/database";
import { parseStoredBlock } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { pageContentSnapshotSchema } from "../pages/page-content-snapshot.js";
import { ThemesService } from "../themes/themes.service.js";

export interface PublicSiteView {
  name: string;
  slug: string;
  theme: { tokens: unknown };
  pages: Array<{ slug: string; isHome: boolean }>;
}

export interface PublicPageView {
  slug: string;
  isHome: boolean;
  seoMeta: unknown;
  blocks: Array<{ type: string; config: unknown }>;
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
      where: { slug: siteSlug, status: { not: "ARCHIVED" } },
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
    // si una página existe, solo el de qué aparece en el menú.
    const navPages = await this.prisma.page.findMany({
      where: { siteId: site.id, deletedAt: null, visibility: "PUBLIC", status: "PUBLISHED" },
      orderBy: { position: "asc" },
      select: { slug: true, isHome: true },
    });

    return {
      name: site.name,
      slug: site.slug,
      theme: { tokens: theme.tokens },
      pages: navPages,
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
        return parsed.renderable ? { type: block.type, config: parsed.config } : null;
      })
      .filter((block): block is { type: string; config: unknown } => block !== null);

    return {
      slug: page.slug,
      isHome: page.isHome,
      seoMeta: snapshot.seoMeta,
      blocks,
    };
  }
}
