import { z } from "zod";

// Forma interna del "content_snapshot" que guarda cada `PageVersion` (F2.6). No es un contrato de
// `@impulza/contracts`: el cliente nunca construye ni envía un snapshot, solo edita páginas y
// bloques por los endpoints normales — esto es exclusivamente el formato de almacenamiento que el
// servidor arma al publicar y vuelve a leer al restaurar. Vive acá y no en `@impulza/validation`
// porque nada fuera de este módulo lo necesita.
//
// Captura todo lo que hace falta para reconstruir la página sin depender del estado actual de sus
// bloques (ERD §3, comentario de `PageVersion.content_snapshot`): los campos propios de la página
// que afectan el render público, más la lista completa y ordenada de bloques con su configuración
// vigente al momento de publicar. `position` queda explícito en cada bloque (aunque coincide con
// el índice del arreglo) para que el JSON sea autodescriptivo si algún día se inspecciona a mano.
export const pageContentSnapshotSchema = z.object({
  slug: z.string(),
  visibility: z.enum(["PUBLIC", "HIDDEN"]),
  seoMeta: z.unknown().nullable(),
  blocks: z.array(
    z.object({
      type: z.string(),
      position: z.number().int(),
      configSchemaVersion: z.number().int(),
      visible: z.boolean(),
      scheduledStart: z.iso.datetime({ offset: true }).nullable(),
      scheduledEnd: z.iso.datetime({ offset: true }).nullable(),
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
