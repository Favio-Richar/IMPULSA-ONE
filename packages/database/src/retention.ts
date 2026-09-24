import type { PrismaClient } from "@prisma/client";

// Revisión de retención de contactos (ADR-004 punto 4). Vive junto al modelo de datos y no en
// `apps/worker` para que la misma función la ejerciten las pruebas contra Postgres real de este
// paquete y el job diario del worker, sin copiarla.

/**
 * "Última interacción" de un contacto: lo más reciente entre su última edición (`updated_at` —
 * editarlo, conservarlo o cambiarle el estado es una interacción real del dueño) y su último
 * evento de línea de tiempo (envío de formulario, nota...). Sin eventos, cuenta su creación.
 */
const LAST_INTERACTION_SQL = `GREATEST(
  c.updated_at,
  COALESCE((SELECT max(e.created_at) FROM contact_events e WHERE e.contact_id = c.id), c.created_at)
)`;

export function contactRetentionCutoff(now: Date, months: number): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

/**
 * Marca para revisión los contactos sin interacción desde hace `months` meses, y desmarca los que
 * volvieron a tener actividad. **Nunca borra**: un dato de contacto de negocio no se purga sin que
 * el propietario lo confirme (ADR-004), a diferencia del evento anónimo de analítica.
 *
 * SQL directo y no el cliente de Prisma: `@updatedAt` de Prisma pisaría `updated_at` al escribir la
 * marca, y el propio job pasaría a contar como "interacción" — el contacto se desmarcaría solo al
 * día siguiente.
 */
export async function flagContactsForRetentionReview(
  prisma: PrismaClient,
  /** Sin `organizationId`, todas las organizaciones (el job diario). Con él, solo esa — para
   *  pruebas y para una revisión puntual, sin tocar datos de nadie más. */
  options: { months: number; now?: Date; organizationId?: string },
): Promise<{ flagged: number; cleared: number }> {
  const now = options.now ?? new Date();
  const cutoff = contactRetentionCutoff(now, options.months);
  // `$n::uuid IS NULL OR ...`: el mismo SQL sirve para las dos formas, siempre parametrizado.
  const scope = (param: number) => `($${param}::uuid IS NULL OR c.organization_id = $${param}::uuid)`;
  const organizationId = options.organizationId ?? null;

  const flagged = await prisma.$executeRawUnsafe(
    `UPDATE contacts c SET retention_review_at = $1
     WHERE c.retention_review_at IS NULL AND ${LAST_INTERACTION_SQL} < $2 AND ${scope(3)}`,
    now,
    cutoff,
    organizationId,
  );
  const cleared = await prisma.$executeRawUnsafe(
    `UPDATE contacts c SET retention_review_at = NULL
     WHERE c.retention_review_at IS NOT NULL AND ${LAST_INTERACTION_SQL} >= $1 AND ${scope(2)}`,
    cutoff,
    organizationId,
  );

  return { flagged, cleared };
}
