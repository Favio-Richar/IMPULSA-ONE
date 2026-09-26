import { seoMetaSchema } from "@impulza/validation";
import { z } from "zod";

// Forma interna del "content_snapshot" que guarda cada `PageVersion` (F2.6). No es un contrato de
// `@impulza/contracts`: ningún cliente (dashboard, apps/web) construye ni envía un snapshot, solo
// edita páginas y bloques por los endpoints normales, o lee el contenido ya resuelto del render
// público (F2.7) — esto es exclusivamente el formato de almacenamiento que el servidor arma al
// publicar y vuelve a leer al restaurar o al resolver una página pública. Vive acá y no en
// `@impulza/validation` porque solo lo usan otros módulos de este mismo backend (`pages`,
// `public-sites`), nunca un cliente fuera de `apps/api`.
//
// Captura todo lo que hace falta para reconstruir la página sin depender del estado actual de sus
// bloques (ERD §3, comentario de `PageVersion.content_snapshot`): los campos propios de la página
// que afectan el render público, más la lista completa y ordenada de bloques con su configuración
// vigente al momento de publicar. `position` queda explícito en cada bloque (aunque coincide con
// el índice del arreglo) para que el JSON sea autodescriptivo si algún día se inspecciona a mano.
export const pageContentSnapshotSchema = z.object({
  slug: z.string(),
  visibility: z.enum(["PUBLIC", "HIDDEN"]),
  // Tipado desde F2.8 (antes `z.unknown()`): revalida acá lo que ya se validó al guardar, mismo
  // criterio que la config de cada bloque — el snapshot no confía ciegamente en lo que hay en la
  // columna JSON de Postgres.
  seoMeta: seoMetaSchema.nullable(),
  blocks: z.array(
    z.object({
      // Desde F3.6: el id del bloque vivo al publicar. Nunca sale al visitante (contrato público
      // de F2.7): el navegador informa slug de página + `position`, y la API resuelve acá a qué
      // bloque corresponde el clic (`block_click`). Opcional: las versiones publicadas antes no lo
      // tienen y siguen siendo válidas, solo sin medición por bloque hasta volver a publicar.
      id: z.uuid().optional(),
      type: z.string(),
      position: z.number().int(),
      configSchemaVersion: z.number().int(),
      visible: z.boolean(),
      scheduledStart: z.iso.datetime({ offset: true }).nullable(),
      scheduledEnd: z.iso.datetime({ offset: true }).nullable(),
      // PP5: solo presente (y `true`) en el bloque principal. Omitido en el resto a propósito: así
      // una versión publicada antes de PP5 es idéntica al estado vivo sin cambios, y la página no
      // aparece de pronto con "cambios sin publicar".
      isPrimary: z.literal(true).optional(),
      // Sin tipar por catálogo, mismo criterio que `BlockResponse.config`: la forma exacta depende
      // de `type` y vive en `@impulza/validation`. El snapshot no revalida contra ese catálogo al
      // restaurar — guarda y devuelve exactamente lo que ya se validó y sanitizó al publicar.
      config: z.unknown(),
    }),
  ),
});

export type PageContentSnapshot = z.infer<typeof pageContentSnapshotSchema>;

/** Recursivamente ordena las claves de cada objeto — JSONB de Postgres no preserva el orden. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/**
 * Compara dos snapshots por contenido, no por identidad de objeto ni por orden de claves — lo que
 * exige la publicación idempotente (F2.6, "publicar dos veces sin cambios no genera versiones
 * basura"). Necesario porque el snapshot recién construido y el que vuelve de Postgres (JSONB
 * reordena claves) no son comparables con un `JSON.stringify` directo aunque representen lo mismo.
 */
export function snapshotsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}
