import { getBlockDefinition } from "./catalog.js";

/**
 * Resultado de leer un bloque **ya guardado**. Es distinto de validar una entrada del usuario:
 * acá el dato ya está en la base, así que rechazarlo con un error no es una opción — hay que
 * decidir qué hacer con él sin romper la página (criterio de degradación controlada de F2.4).
 *
 * Los tres motivos de "no renderizable" son situaciones reales:
 * - `unknown_type`: la base tiene un bloque de un tipo que este despliegue todavía no conoce
 *   (rollback de una versión, o un nodo viejo durante un despliegue progresivo).
 * - `future_version`: el bloque se guardó con un `config_schema_version` mayor al que entiende
 *   este código. Renderizarlo "a ver qué pasa" mostraría datos mal interpretados.
 * - `invalid_config`: la configuración dejó de cumplir el esquema (migración incompleta, edición
 *   manual en base). Se omite el bloque, no la página entera.
 */
export type StoredBlockResult<TConfig = unknown> =
  | { renderable: true; config: TConfig }
  | { renderable: false; reason: "unknown_type" | "future_version" | "invalid_config" };

export function parseStoredBlock(
  type: string,
  schemaVersion: number,
  config: unknown,
): StoredBlockResult {
  const definition = getBlockDefinition(type);

  if (!definition) {
    return { renderable: false, reason: "unknown_type" };
  }

  if (schemaVersion > definition.version) {
    return { renderable: false, reason: "future_version" };
  }

  const parsed = definition.schema.safeParse(config);

  if (!parsed.success) {
    return { renderable: false, reason: "invalid_config" };
  }

  return { renderable: true, config: parsed.data };
}
