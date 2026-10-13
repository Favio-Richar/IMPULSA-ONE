// Pestañas del detalle de un sitio. La activa viaja en la URL (`?tab=apariencia`): un valor desconocido o ausente cae en «resumen»,
// nunca en una pantalla vacía. Puro, para poder probarlo solo.

export const SITE_TAB_VALUES = ["resumen", "apariencia", "paginas", "comercio", "contenido", "dominio"] as const;
export type SiteTab = (typeof SITE_TAB_VALUES)[number];
export const DEFAULT_SITE_TAB: SiteTab = "resumen";

export function parseSiteTab(value: string | null | undefined): SiteTab {
  return SITE_TAB_VALUES.find((tab) => tab === value) ?? DEFAULT_SITE_TAB;
}
