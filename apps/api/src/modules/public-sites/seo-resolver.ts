import { SEO_DESCRIPTION_MAX, type SeoMeta, type SeoRobots } from "@impulza/validation";

/**
 * SEO por página, ya resuelto (F2.8): lo que el usuario escribió (`SeoMeta`, todo opcional) más los
 * valores por defecto derivados del contenido real cuando no escribió nada — nunca un `<title>`
 * vacío ni una descripción genérica. Es lo que expone `GET /public/sites/*` (`publicSeoResponse`,
 * `@impulza/contracts`); `apps/web` lo pinta tal cual, sin repetir esta lógica.
 */
export interface ResolvedSeo {
  title: string;
  description?: string;
  /** Relativo (`/mi-sitio` o `/mi-sitio/servicios`) — `apps/web` arma la URL absoluta. */
  canonicalPath: string;
  robots: SeoRobots;
  openGraph: { title: string; description?: string; image?: string };
}

interface ResolvableBlock {
  type: string;
  config: unknown;
}

function readString(config: unknown, key: string): string | undefined {
  if (!config || typeof config !== "object") {
    return undefined;
  }
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Texto enriquecido ya sanitizado (F2.4) a texto plano — suficiente para un `<meta description>`,
 *  que nunca interpreta HTML de todos modos. No es un sanitizador: es solo para desnudar el texto. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  // Corta en el último espacio antes del límite para no partir una palabra a la mitad.
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Primer título con contenido real: el nombre de un bloque de perfil, o el título de un hero. */
function deriveTitle(siteName: string, page: { slug: string; isHome: boolean }, blocks: ResolvableBlock[]): string {
  for (const block of blocks) {
    if (block.type === "profile") {
      const name = readString(block.config, "name");
      if (name) {
        return `${name} · ${siteName}`;
      }
    }
    if (block.type === "hero") {
      const title = readString(block.config, "title");
      if (title) {
        return `${title} · ${siteName}`;
      }
    }
  }
  return page.isHome ? siteName : `${page.slug} · ${siteName}`;
}

// Orden de prioridad: el primer bloque (en el orden real de la página) que tenga alguno de estos
// campos con contenido gana. `richText: true` marca los campos que hay que desnudar antes de
// truncar — guardan HTML saneado (F2.4), no texto plano.
const DESCRIPTION_SOURCES: ReadonlyArray<{ type: string; field: string; richText: boolean }> = [
  { type: "hero", field: "subtitle", richText: false },
  { type: "profile", field: "headline", richText: false },
  { type: "profile", field: "bio", richText: true },
  { type: "service", field: "description", richText: true },
  { type: "text", field: "html", richText: true },
];

function deriveDescription(blocks: ResolvableBlock[]): string | undefined {
  for (const source of DESCRIPTION_SOURCES) {
    for (const block of blocks) {
      if (block.type !== source.type) {
        continue;
      }
      const raw = readString(block.config, source.field);
      if (!raw) {
        continue;
      }
      const plain = source.richText ? stripHtml(raw) : raw;
      if (plain.length > 0) {
        return truncate(plain, SEO_DESCRIPTION_MAX);
      }
    }
  }
  return undefined;
}

export function resolveSeo(input: {
  site: { name: string };
  page: { slug: string; isHome: boolean };
  seoMeta: SeoMeta | null;
  blocks: ResolvableBlock[];
  /** Ruta relativa de la página a la que apunta `seoMeta.canonicalPageSlug`, ya validada contra la
   *  base de datos (existe, sigue publicada, del mismo sitio) — o `null` si no hay override, o si
   *  el override quedó huérfano (la página destino se borró o despublicó desde que se guardó). */
  canonicalOverridePath: string | null;
  selfPath: string;
}): ResolvedSeo {
  const meta = input.seoMeta ?? {};

  const title = meta.title ?? deriveTitle(input.site.name, input.page, input.blocks);
  const description = meta.description ?? deriveDescription(input.blocks);

  return {
    title,
    description,
    canonicalPath: input.canonicalOverridePath ?? input.selfPath,
    robots: meta.robots ?? "index_follow",
    openGraph: {
      title: meta.openGraph?.title ?? title,
      description: meta.openGraph?.description ?? description,
      image: meta.openGraph?.image,
    },
  };
}
