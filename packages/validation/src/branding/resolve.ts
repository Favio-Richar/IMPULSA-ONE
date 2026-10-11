import { DEFAULT_PLATFORM_BRANDING } from "./index.js";
import { hexColorSchema, isSafeAssetUrl } from "./common.js";

/**
 * Cascada de marca (ADR-028 §4) — **el único lugar que decide qué marca se aplica**.
 * Es una función pura y sin dependencias de base de datos para que la use la API y el worker
 * (que envía correos desde otro proceso) sin duplicar la regla.
 *
 * **Dos audiencias** (decisión de F9.7a, anotada en ADR-028): la marca blanca de la agencia «reemplaza a la de la plataforma» (ADR §3) y,
 * a la vez, la marca propia del negocio manda sobre lo que ese negocio envía a SUS clientes. Por eso el orden depende de a quién se habla:
 * - `team` (el panel y los avisos que ve el equipo del cliente): marca blanca → marca de la organización → plataforma;
 * - `customer` (lo que el negocio envía a su público): marca de la organización → marca blanca → plataforma.
 * Cada campo se resuelve por separado: un negocio con solo su nombre configurado hereda el logo y los colores del siguiente nivel.
 */

/** Lo que guarda una organización (todo opcional: una organización sin configurar cae a la plataforma). */
export interface OrganizationBrandRow {
  displayName: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  contactEmail: string | null;
}

/** Lo que una agencia configuró como marca blanca, ya filtrado para un cliente que la tiene activa. */
export interface WhiteLabelBrandRow extends OrganizationBrandRow {
  footerText: string | null;
  /** Nombre de la agencia que presta la marca (para la cabecera legal de los correos, F9.7b). */
  agencyName: string;
  agencyOrganizationId: string;
}

export type BrandAudience = "team" | "customer";

/** Lo público de la marca de la plataforma. */
export interface PlatformBrandRow {
  name: string;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export interface ResolvedBrand {
  displayName: string;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  contactEmail: string | null;
  /** Nombre con el que se firma lo que envía la organización: el de su marca (ADR-028 §5). */
  senderName: string;
  /** Siempre `null` hasta que haya un dominio verificado: un remitente propio lo exige (ADR-028 §5, F9.7b). */
  senderEmail: string | null;
  /** Si la marca viene (en parte) de una agencia con marca blanca: de cuál (pie y cabecera legal). */
  whiteLabel: { agencyOrganizationId: string; agencyName: string; footerText: string | null } | null;
}

export const DEFAULT_PLATFORM_BRAND_ROW: PlatformBrandRow = {
  name: DEFAULT_PLATFORM_BRANDING.name,
  logoLightUrl: DEFAULT_PLATFORM_BRANDING.logoLightUrl,
  logoDarkUrl: DEFAULT_PLATFORM_BRANDING.logoDarkUrl,
  faviconUrl: DEFAULT_PLATFORM_BRANDING.faviconUrl,
  primaryColor: DEFAULT_PLATFORM_BRANDING.primaryColor,
  secondaryColor: DEFAULT_PLATFORM_BRANDING.secondaryColor,
};

/** El primero que tenga valor, en el orden dado. */
function first<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) if (value !== null && value !== undefined) return value;
  return null;
}

export function cascadeBrand(
  organization: OrganizationBrandRow | null,
  platform: PlatformBrandRow,
  whiteLabel: WhiteLabelBrandRow | null = null,
  audience: BrandAudience = "customer",
): ResolvedBrand {
  const order = audience === "team" ? [whiteLabel, organization] : [organization, whiteLabel];
  const pick = <K extends keyof OrganizationBrandRow>(key: K): OrganizationBrandRow[K] | null =>
    first(...order.map((row) => (row ? row[key] : null)));

  const displayName = pick("displayName") ?? platform.name;
  const usesWhiteLabel =
    whiteLabel !== null && order.some((row) => row === whiteLabel) &&
    (["displayName", "logoLightUrl", "logoDarkUrl", "faviconUrl", "primaryColor", "secondaryColor"] as const).some(
      (key) => pick(key) !== null && pick(key) === whiteLabel[key],
    );
  return {
    displayName,
    logoLightUrl: pick("logoLightUrl") ?? platform.logoLightUrl ?? null,
    logoDarkUrl: pick("logoDarkUrl") ?? platform.logoDarkUrl ?? null,
    faviconUrl: pick("faviconUrl") ?? platform.faviconUrl ?? null,
    primaryColor: pick("primaryColor") ?? platform.primaryColor,
    secondaryColor: pick("secondaryColor") ?? platform.secondaryColor,
    contactEmail: pick("contactEmail"),
    senderName: displayName,
    senderEmail: null,
    whiteLabel:
      usesWhiteLabel && whiteLabel
        ? { agencyOrganizationId: whiteLabel.agencyOrganizationId, agencyName: whiteLabel.agencyName, footerText: whiteLabel.footerText }
        : null,
  };
}

/** Cargadores de datos: la API y el worker los implementan con su propio cliente de base de datos. */
export interface BrandLoaders {
  organization: (organizationId: string) => Promise<OrganizationBrandRow | null>;
  platform: () => Promise<PlatformBrandRow | null>;
  /** La marca blanca que aplica a esta organización (relación activa y activada), o `null`. Opcional: sin ella no hay marca blanca. */
  whiteLabel?: (organizationId: string) => Promise<WhiteLabelBrandRow | null>;
}

/** Resuelve la marca efectiva; **nunca lanza**: ante cualquier fallo devuelve la marca por defecto. */
export async function resolveOrganizationBrand(
  loaders: BrandLoaders,
  organizationId: string,
  audience: BrandAudience = "customer",
): Promise<ResolvedBrand> {
  let organization: OrganizationBrandRow | null = null;
  let whiteLabel: WhiteLabelBrandRow | null = null;
  let platform: PlatformBrandRow = DEFAULT_PLATFORM_BRAND_ROW;
  try {
    organization = await loaders.organization(organizationId);
  } catch {
    // Sin perfil legible, la organización usa la marca de la plataforma.
  }
  try {
    platform = (await loaders.platform()) ?? DEFAULT_PLATFORM_BRAND_ROW;
  } catch {
    // Sin marca de plataforma legible, la de fábrica.
  }
  try {
    whiteLabel = (await loaders.whiteLabel?.(organizationId)) ?? null;
  } catch {
    // Sin marca blanca legible, se sigue con la de la organización y la de la plataforma.
  }
  return cascadeBrand(organization, platform, whiteLabel, audience);
}

// ---- Valores por defecto de las páginas nuevas (F9.2 criterio 4a) -----------------------------------

interface BlockSeedLike {
  type: string;
  config?: unknown;
}

/**
 * Aplica la marca **propia** de la organización a los bloques de una plantilla recién aplicada:
 * - Perfil: si la persona no puso nombre, el nombre visible de su marca; y su logo como avatar si el
 *   perfil no trae uno y no es de portada completa (`layout: "hero"`).
 * Solo se usan valores que la organización configuró (nunca los de la plataforma: una página de un
 * cliente no debe nacer con el logo de Impulza One) y solo logos que pasan `isSafeAssetUrl`. Nunca pisa
 * lo que la persona ya escribió.
 */
export function applyOrganizationBrandDefaults<T extends BlockSeedLike>(
  blocks: readonly T[],
  organization: OrganizationBrandRow | null,
  personalizedName: string | undefined,
): T[] {
  if (!organization) return blocks.map((block) => ({ ...block }));

  const logo = organization.logoLightUrl && isSafeAssetUrl(organization.logoLightUrl) ? organization.logoLightUrl : null;
  const name = organization.displayName?.trim() ? organization.displayName.trim() : null;

  return blocks.map((block) => {
    if (block.type !== "profile") return { ...block };
    const config = { ...((block.config ?? {}) as Record<string, unknown>) };
    if (!personalizedName && name) config.name = name;
    if (logo && config.avatar === undefined && config.layout !== "hero") {
      config.avatar = { url: logo, alt: `Logo de ${String(config.name ?? name ?? "tu marca")}`.slice(0, 300) };
    }
    return { ...block, config };
  });
}

/** Solo para quien arma CSS o HTML a partir de datos guardados: un color que no sea hexadecimal se descarta. */
export function safeBrandColor(value: string, fallback: string): string {
  return hexColorSchema.safeParse(value).success ? value : fallback;
}
