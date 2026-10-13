import type { SiteDomainResponse, SiteResponse } from "@impulza/contracts";

// Reglas puras de la vista «Sitios» (tarjetas): URL pública, estado del dominio, orden y sugerencias para duplicar. Sin React ni red,
// para poder probarlas solas.

/**
 * Dirección pública de un sitio: su dominio propio si ya está verificado (es la que ve la gente), y si no, `{base}/{slug}` (la
 * dirección de la plataforma, que siempre funciona).
 */
export function sitePublicUrl(webBaseUrl: string, slug: string, verifiedDomain: string | null = null): string {
  if (verifiedDomain) return `https://${verifiedDomain}`;
  return `${webBaseUrl.replace(/\/+$/, "")}/${slug}`;
}

export type DomainBadgeKind = "none" | "pending" | "verified";

export interface DomainBadge {
  kind: DomainBadgeKind;
  /** El dominio que explica el estado (el verificado, o el pendiente más reciente); `null` sin dominio. */
  domain: string | null;
}

/** Estado de dominio propio de un sitio: verificado gana a pendiente; un dominio con fallo de verificación sigue pendiente de arreglo. */
export function domainBadge(domains: ReadonlyArray<Pick<SiteDomainResponse, "domain" | "status">>): DomainBadge {
  const verified = domains.find((entry) => entry.status === "VERIFIED");
  if (verified) return { kind: "verified", domain: verified.domain };
  const pending = domains[0];
  if (pending) return { kind: "pending", domain: pending.domain };
  return { kind: "none", domain: null };
}

export type SiteSortKey = "recent" | "visits" | "name";

export const SITE_SORT_OPTIONS: ReadonlyArray<{ value: SiteSortKey; label: string }> = [
  { value: "recent", label: "Más reciente" },
  { value: "visits", label: "Más visitas" },
  { value: "name", label: "Nombre (A–Z)" },
];

export function isSiteSortKey(value: string): value is SiteSortKey {
  return SITE_SORT_OPTIONS.some((option) => option.value === value);
}

/**
 * Ordena sin tocar la lista original. «Más visitas» desempata por reciente y deja al final los sitios sin dato todavía (`undefined`),
 * para que un sitio que aún carga no salte de lugar al llegar su número.
 */
export function sortSites(
  sites: readonly SiteResponse[],
  key: SiteSortKey,
  visits: ReadonlyMap<string, number | undefined>,
): SiteResponse[] {
  const byRecent = (a: SiteResponse, b: SiteResponse) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  const copy = [...sites];
  if (key === "name") return copy.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }) || byRecent(a, b));
  if (key === "visits") {
    return copy.sort((a, b) => {
      const av = visits.get(a.id);
      const bv = visits.get(b.id);
      if (av === undefined && bv === undefined) return byRecent(a, b);
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      return bv - av || byRecent(a, b);
    });
  }
  return copy.sort(byRecent);
}

const SLUG_MAX = 63;

/** «Copia de {nombre}» sin pasar del máximo del nombre. */
export function suggestCopyName(name: string): string {
  return `Copia de ${name}`.slice(0, 120);
}

/**
 * Un slug sugerido para la copia: `{slug}-copia`, `{slug}-copia-2`… el primero que no esté en uso entre los sitios que ya se
 * conocen. Respeta el largo máximo recortando el origen. (La API vuelve a validar: otra organización puede tener ese slug.)
 */
export function suggestCopySlug(slug: string, taken: readonly string[]): string {
  const used = new Set(taken.map((value) => value.toLowerCase()));
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const suffix = attempt === 1 ? "-copia" : `-copia-${attempt}`;
    const base = slug.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "");
    const candidate = `${base}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${slug.slice(0, SLUG_MAX - 5)}-copia`;
}

/** Cuántos sitios cuentan contra el límite y si la organización ya no puede crear más. `limit` `null` = ilimitado. */
export function siteUsage(used: number, limit: number | null): { used: number; limit: number | null; reached: boolean; ratio: number | null } {
  if (limit === null) return { used, limit, reached: false, ratio: null };
  return { used, limit, reached: used >= limit, ratio: limit === 0 ? 1 : Math.min(1, used / limit) };
}
