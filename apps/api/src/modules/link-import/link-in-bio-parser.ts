import { detectSocialNetwork, safeUrlSchema, TEMPLATE_MAX_IMPORTED_LINKS, TEMPLATE_MAX_IMPORTED_SOCIALS } from "@impulza/validation";

export interface ParsedLinkInBio {
  title: string | null;
  socials: string[];
  links: Array<{ label: string; url: string }>;
}

const MAX_CANDIDATES = 200;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function walk(node: unknown, out: Array<{ label: string; url: string }>, depth = 0): void {
  if (out.length >= MAX_CANDIDATES || depth > 12 || node === null || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, out, depth + 1);
    }
    return;
  }
  const record = node as Record<string, unknown>;
  const url = typeof record["url"] === "string" ? record["url"] : typeof record["href"] === "string" ? record["href"] : null;
  const label = [record["title"], record["label"], record["name"], record["text"]].find((value): value is string => typeof value === "string");
  if (url && label && /^https?:\/\//i.test(url)) {
    out.push({ label, url });
  }
  for (const value of Object.values(record)) {
    walk(value, out, depth + 1);
  }
}

/**
 * Lee los enlaces de una página de «enlace en bio» ya descargada. Función pura (no hace red): usa el JSON incrustado de la
 * página (`__NEXT_DATA__`) y, si no hay, los `<a href>`. Todo resultado pasa por `safeUrlSchema` (solo http/https, sin
 * credenciales ni destinos internos) y se deduplica; lo que es una red social se separa de los enlaces propios.
 */
export function parseLinkInBio(html: string, pageHost: string): ParsedLinkInBio {
  const candidates: Array<{ label: string; url: string }> = [];

  const next = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (next?.[1]) {
    try {
      walk(JSON.parse(next[1]), candidates);
    } catch {
      // JSON ilegible: se cae al respaldo de anclas.
    }
  }
  if (candidates.length === 0) {
    const anchor = /<a\b[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    while ((match = anchor.exec(html)) !== null && candidates.length < MAX_CANDIDATES) {
      const label = decodeEntities(match[2] ?? "");
      if (label !== "") {
        candidates.push({ label, url: decodeEntities(match[1] ?? "") });
      }
    }
  }

  const socials: string[] = [];
  const links: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const url = candidate.url.trim();
    if (seen.has(url) || !safeUrlSchema.safeParse(url).success) {
      continue;
    }
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    // Enlaces de la propia plataforma (términos, «crea tu Linktree», cookies…) no son del usuario.
    if (host === pageHost || host.endsWith(`.${pageHost}`)) {
      continue;
    }
    seen.add(url);
    if (detectSocialNetwork(url)) {
      if (socials.length < TEMPLATE_MAX_IMPORTED_SOCIALS) {
        socials.push(url);
      }
    } else if (links.length < TEMPLATE_MAX_IMPORTED_LINKS) {
      const label = decodeEntities(candidate.label).slice(0, 80);
      if (label !== "") {
        links.push({ label, url });
      }
    }
  }

  const title = /<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i.exec(html)?.[1] ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? null;
  return { title: title ? decodeEntities(title).slice(0, 120) || null : null, socials, links };
}
