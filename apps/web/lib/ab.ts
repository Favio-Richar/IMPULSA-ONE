import { AB_BUCKET_COOKIE, AB_BUCKET_COUNT, abVariantFor, applyAbVariant, parseAbBucket } from "@impulza/validation";

// Pruebas A/B en el sitio público (F6.5, ADR-011). La variante se elige acá, en el servidor, con el
// grupo del visitante (cookie propia del sitio con un número de 0 a 99) y la misma función con la que
// la API cuenta (`abVariantFor`): el HTML ya llega con la variante correcta, sin parpadeo, y el
// navegador nunca informa qué variante vio.

/** Grupo guardado en la cabecera `Cookie`, o `null` si no hay uno válido. */
export function abBucketFromCookieHeader(cookieHeader: string | null | undefined): number | null {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === AB_BUCKET_COOKIE) {
      return parseAbBucket(rest.join("="));
    }
  }
  return null;
}

/** Grupo nuevo al azar para un visitante que todavía no tiene. */
export function randomAbBucket(random: () => number = Math.random): number {
  return Math.min(AB_BUCKET_COUNT - 1, Math.floor(random() * AB_BUCKET_COUNT));
}

interface ExperimentBlock {
  config: unknown;
  experiment?: { key: string; variantB: Record<string, unknown> };
}

/**
 * Bloques listos para pintar: en los que tienen prueba, la configuración de la variante que le toca
 * al grupo. Se quita `experiment` para que el render no reciba nada de la prueba.
 */
export function resolveExperimentBlocks<T extends ExperimentBlock>(blocks: T[], bucket: number): Array<Omit<T, "experiment">> {
  return blocks.map(({ experiment, ...block }) => {
    if (!experiment || abVariantFor(experiment.key, bucket) === "a") {
      return block;
    }
    return { ...block, config: applyAbVariant(block.config, experiment.variantB) };
  });
}

export function hasExperiments(blocks: ExperimentBlock[]): boolean {
  return blocks.some((block) => block.experiment !== undefined);
}
