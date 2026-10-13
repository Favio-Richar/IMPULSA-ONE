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
  /** Datos estructurados (schema.org) ya resueltos del contenido real (F11, "SEO avanzado",
   *  decisión del propietario 2026-10-13). Sin `url`: `apps/web` la agrega con su propio origen,
   *  igual que ya hace con `canonicalPath`. Vacío = nada que estructurar en esta página. */
  structuredData: Array<Record<string, unknown>>;
}

interface ResolvableBlock {
  type: string;
  config: unknown;
}

function readRecord(config: unknown): Record<string, unknown> | undefined {
  return config && typeof config === "object" ? (config as Record<string, unknown>) : undefined;
}

function readString(config: unknown, key: string): string | undefined {
  const value = readRecord(config)?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readArray(config: unknown, key: string): unknown[] | undefined {
  const value = readRecord(config)?.[key];
  return Array.isArray(value) && value.length > 0 ? value : undefined;
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

/** `sameAs` (schema.org): toda red social de cualquier bloque `social` (`links`) o del bloque
 *  `profile` (`socials`, opcional) de la página, sin duplicados y en el orden en que aparecen. */
function deriveSameAs(blocks: ResolvableBlock[]): string[] {
  const urls: string[] = [];
  for (const block of blocks) {
    const links =
      block.type === "social" ? readArray(block.config, "links") : block.type === "profile" ? readArray(block.config, "socials") : undefined;
    if (!links) {
      continue;
    }
    for (const link of links) {
      const url = readString(link, "url");
      if (url && !urls.includes(url)) {
        urls.push(url);
      }
    }
  }
  return urls;
}

/** Primer teléfono/correo de contacto directo de la página (`whatsapp` o `contact_actions`). */
function deriveContact(blocks: ResolvableBlock[]): { telephone?: string; email?: string } {
  for (const block of blocks) {
    if (block.type === "whatsapp") {
      const phone = readString(block.config, "phone");
      if (phone) {
        return { telephone: phone };
      }
    }
    if (block.type === "contact_actions") {
      const phone = readString(block.config, "phone");
      const email = readString(block.config, "email");
      if (phone || email) {
        return { telephone: phone, email };
      }
    }
  }
  return {};
}

/** Primera imagen con la que presentarse: el avatar del bloque `profile`. */
function deriveImage(blocks: ResolvableBlock[]): string | undefined {
  for (const block of blocks) {
    if (block.type !== "profile") {
      continue;
    }
    const avatar = readRecord(block.config)?.avatar;
    const url = readString(avatar, "url");
    if (url) {
      return url;
    }
  }
  return undefined;
}

/** Negocio o profesional de la página (F11): `LocalBusiness` si hay una dirección real (bloque
 *  `map`), `Organization` si no — ambos válidos para una persona que se presenta como marca
 *  (ADR-028 §7 ya trata estos sitios como negocios, no como perfiles privados). Sin nombre no hay
 *  nada que estructurar: una página sin bloque `profile` ni `hero` no inventa uno. */
function deriveBusinessNode(siteName: string, blocks: ResolvableBlock[]): Record<string, unknown> | undefined {
  const profile = blocks.find((block) => block.type === "profile");
  const name = (profile && readString(profile.config, "name")) ?? siteName;
  if (!name) {
    return undefined;
  }

  const map = blocks.find((block) => block.type === "map");
  const address = map ? readString(map.config, "address") : undefined;
  const { telephone, email } = deriveContact(blocks);
  const image = deriveImage(blocks);
  const sameAs = deriveSameAs(blocks);
  const description = profile ? readString(profile.config, "headline") : undefined;

  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": address ? "LocalBusiness" : "Organization",
    name,
  };
  if (description) node.description = description;
  if (image) node.image = image;
  if (address) node.address = address;
  if (telephone) node.telephone = telephone;
  if (email) node.email = email;
  if (sameAs.length > 0) node.sameAs = sameAs;
  return node;
}

/** `FAQPage` (schema.org) por cada bloque `faq` de la página — Google solo pinta el "rich result"
 *  en la página donde el visitante de verdad ve esas preguntas, así que se genera una por bloque y
 *  no una sola para todo el sitio. */
function deriveFaqNodes(blocks: ResolvableBlock[]): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    if (block.type !== "faq") {
      continue;
    }
    const items = readArray(block.config, "items");
    if (!items) {
      continue;
    }
    const mainEntity = items
      .map((item) => {
        const question = readString(item, "question");
        const answer = readString(item, "answer");
        if (!question || !answer) {
          return null;
        }
        return {
          "@type": "Question",
          name: question,
          acceptedAnswer: { "@type": "Answer", text: stripHtml(answer) },
        };
      })
      .filter((entry) => entry !== null);
    if (mainEntity.length > 0) {
      nodes.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity });
    }
  }
  return nodes;
}

/** Un `Event` (schema.org) por fila de cada bloque `events` — `startDate`/`endDate` ya vienen en
 *  hora local con su propia zona (`localDateTimeSchema`); schema.org acepta ISO 8601 con offset,
 *  así que se pasa tal cual sin reconvertir a UTC (reconvertir sin el offset real del `timeZone`
 *  del bloque daría una hora distinta a la que el visitante lee en la página). */
function deriveEventNodes(blocks: ResolvableBlock[]): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    if (block.type !== "events") {
      continue;
    }
    const items = readArray(block.config, "items");
    if (!items) {
      continue;
    }
    for (const item of items) {
      const name = readString(item, "name");
      const start = readString(item, "start");
      if (!name || !start) {
        continue;
      }
      const node: Record<string, unknown> = { "@context": "https://schema.org", "@type": "Event", name, startDate: start };
      const end = readString(item, "end");
      if (end) node.endDate = end;
      nodes.push(node);
    }
  }
  return nodes;
}

/** Mismo cálculo que `formatPrice` de `@impulza/blocks-renderer` (duplicado a propósito: ese
 *  paquete depende de React y no se importa desde la API) — `priceAmount` guarda la unidad mínima
 *  de la moneda (ST §8), que según la moneda no son centavos: CLP no tiene decimales, así que ahí
 *  `priceAmount` ya es el monto completo. `Intl` sabe cuántos decimales tiene cada moneda. */
function priceAmountToDecimal(amount: number, currency: string): string {
  const fractionDigits = new Intl.NumberFormat("es-CL", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return (amount / 10 ** fractionDigits).toFixed(fractionDigits);
}

/** Un `Service` (schema.org), con `Offer` si tiene precio, por cada bloque `service` de la página.
 *  Nunca `AggregateRating`/`Review` acá: Google no permite marcado de reseñas propias en el sitio
 *  del propio negocio (solo reseñas de un agregador independiente), así que el bloque
 *  `testimonials` deliberadamente no aporta datos estructurados. */
function deriveServiceNodes(blocks: ResolvableBlock[]): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    if (block.type !== "service") {
      continue;
    }
    const name = readString(block.config, "name");
    if (!name) {
      continue;
    }
    const node: Record<string, unknown> = { "@context": "https://schema.org", "@type": "Service", name };
    const description = readString(block.config, "description");
    if (description) node.description = stripHtml(description);
    const priceAmount = readRecord(block.config)?.priceAmount;
    const priceCurrency = readString(block.config, "priceCurrency");
    if (typeof priceAmount === "number" && priceCurrency) {
      node.offers = { "@type": "Offer", price: priceAmountToDecimal(priceAmount, priceCurrency), priceCurrency };
    }
    nodes.push(node);
  }
  return nodes;
}

/** Negocio/organización, FAQ, eventos y servicios de la página, ya listos para `<script
 *  type="application/ld+json">` — `apps/web` solo les agrega `url` con su propio origen. */
function deriveStructuredData(siteName: string, blocks: ResolvableBlock[]): Array<Record<string, unknown>> {
  const business = deriveBusinessNode(siteName, blocks);
  return [...(business ? [business] : []), ...deriveFaqNodes(blocks), ...deriveEventNodes(blocks), ...deriveServiceNodes(blocks)];
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
    structuredData: deriveStructuredData(input.site.name, input.blocks),
  };
}
