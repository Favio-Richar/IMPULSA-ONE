import { DEFAULT_PLATFORM_BRANDING } from "./index.js";
import { hexColorSchema, isSafeAssetUrl } from "./common.js";

/**
 * Cascada de marca (ADR-028 §4) — **el único lugar que decide qué marca se aplica**.
 * Orden: marca blanca de la agencia (F9.7, aún no existe) → marca de la organización → marca de la
 * plataforma. Es una función pura y sin dependencias de base de datos para que la use la API y el worker
 * (que envía correos desde otro proceso) sin duplicar la regla.
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
  /** Siempre `null` hasta F9.7: un remitente propio exige un dominio verificado. */
  senderEmail: string | null;
}

export const DEFAULT_PLATFORM_BRAND_ROW: PlatformBrandRow = {
  name: DEFAULT_PLATFORM_BRANDING.name,
  logoLightUrl: DEFAULT_PLATFORM_BRANDING.logoLightUrl,
  logoDarkUrl: DEFAULT_PLATFORM_BRANDING.logoDarkUrl,
  faviconUrl: DEFAULT_PLATFORM_BRANDING.faviconUrl,
  primaryColor: DEFAULT_PLATFORM_BRANDING.primaryColor,
  secondaryColor: DEFAULT_PLATFORM_BRANDING.secondaryColor,
};

export function cascadeBrand(organization: OrganizationBrandRow | null, platform: PlatformBrandRow): ResolvedBrand {
  const displayName = organization?.displayName ?? platform.name;
  return {
    displayName,
    logoLightUrl: organization?.logoLightUrl ?? platform.logoLightUrl ?? null,
    logoDarkUrl: organization?.logoDarkUrl ?? platform.logoDarkUrl ?? null,
    faviconUrl: organization?.faviconUrl ?? platform.faviconUrl ?? null,
    primaryColor: organization?.primaryColor ?? platform.primaryColor,
    secondaryColor: organization?.secondaryColor ?? platform.secondaryColor,
    contactEmail: organization?.contactEmail ?? null,
    senderName: displayName,
    senderEmail: null,
  };
}

/** Cargadores de datos: la API y el worker los implementan con su propio cliente de base de datos. */
export interface BrandLoaders {
  organization: (organizationId: string) => Promise<OrganizationBrandRow | null>;
  platform: () => Promise<PlatformBrandRow | null>;
}

/** Resuelve la marca efectiva; **nunca lanza**: ante cualquier fallo devuelve la marca por defecto. */
export async function resolveOrganizationBrand(loaders: BrandLoaders, organizationId: string): Promise<ResolvedBrand> {
  let organization: OrganizationBrandRow | null = null;
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
  return cascadeBrand(organization, platform);
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
