import type { PrismaClient } from "@impulza/database";
import type { AnalyticsEventJob } from "./job.js";
import { metricsForEvent, periodFor, visitorsMetric } from "./metrics.js";

// Procesador del pipeline (F3.6). Vive en un paquete compartido y no dentro de `apps/worker` para
// que las pruebas de `apps/api` ejerciten exactamente el mismo código que corre en producción,
// sin copiarlo ni simularlo.

/** `orphaned`: la organización (o el sitio) del evento se borró mientras el evento esperaba en la
 *  cola. No hay dónde registrarlo y reintentar no lo va a arreglar: se descarta sin reintentos, en
 *  vez de ensuciar la dead-letter con fallos que no son fallos. */
export type ProcessAnalyticsEventResult = "recorded" | "duplicate" | "orphaned";

function prismaErrorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return prismaErrorCode(error) === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return prismaErrorCode(error) === "P2003";
}

/**
 * Persiste el evento crudo e incrementa sus agregados en una sola transacción: o queda todo, o no
 * queda nada. Un reintento de BullMQ tras una caída a mitad nunca deja un agregado contado sin su
 * evento (ni al revés).
 *
 * Idempotencia: con `idempotencyKey`, un segundo intento choca contra el índice único de
 * `analytics_events.idempotency_key`, la transacción entera se revierte y los agregados no se
 * tocan. El evento se cuenta una sola vez aunque la red o la cola lo entreguen dos.
 */
export async function processAnalyticsEvent(
  prisma: PrismaClient,
  job: AnalyticsEventJob,
): Promise<ProcessAnalyticsEventResult> {
  const occurredAt = new Date(job.occurredAt);
  const period = periodFor(occurredAt);
  const dayStart = new Date(`${period}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  try {
    await prisma.$transaction(async (tx) => {
      const metrics = metricsForEvent(job);

      if (job.anonymizedVisitorId) {
        // Visitante único del día: el lock serializa solo los eventos de este mismo visitante y
        // tipo (no todo el pipeline), así dos workers en paralelo no pueden contarlo dos veces.
        const lockKey = `${job.organizationId}:${job.siteId ?? "-"}:${job.type}:${job.anonymizedVisitorId}`;
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS acquired`;

        const seenToday = await tx.analyticsEvent.findFirst({
          where: {
            organizationId: job.organizationId,
            siteId: job.siteId,
            type: job.type,
            anonymizedVisitorId: job.anonymizedVisitorId,
            createdAt: { gte: dayStart, lt: dayEnd },
          },
          select: { id: true },
        });
        if (!seenToday) {
          metrics.push(visitorsMetric(job.type));
        }
      }

      await tx.analyticsEvent.create({
        data: {
          organizationId: job.organizationId,
          siteId: job.siteId,
          type: job.type,
          anonymizedVisitorId: job.anonymizedVisitorId,
          device: job.device,
          geoCountry: job.geoCountry,
          geoCity: job.geoCity,
          ...(job.utm ? { utm: { ...job.utm } as Record<string, string> } : {}),
          idempotencyKey: job.idempotencyKey,
          createdAt: occurredAt,
        },
      });

      // Upsert atómico en SQL (no leer-sumar-escribir desde Node): dos workers incrementando la
      // misma métrica a la vez nunca pierden una suma.
      await tx.$executeRaw`
        INSERT INTO analytics_aggregates (id, organization_id, site_id, period, metric, value, created_at, updated_at)
        SELECT gen_random_uuid(), ${job.organizationId}::uuid, ${job.siteId}::uuid, ${period}, metric, 1, now(), now()
        FROM unnest(${metrics}::text[]) AS metric
        ON CONFLICT (organization_id, site_id, period, metric)
        DO UPDATE SET value = analytics_aggregates.value + 1, updated_at = now()`;
    });
  } catch (error) {
    if (job.idempotencyKey && isUniqueViolation(error)) {
      return "duplicate";
    }
    if (isForeignKeyViolation(error)) {
      return "orphaned";
    }
    throw error;
  }

  return "recorded";
}

/** Fecha de corte de la retención: todo evento crudo creado antes de esto se purga. */
export function retentionCutoff(now: Date, retentionMonths: number): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - retentionMonths);
  return cutoff;
}

/**
 * Purga por retención (ADR-004 punto 4): borra `AnalyticsEvent` crudo vencido, por lotes para no
 * tomar un lock largo sobre la tabla que la ingesta escribe en paralelo. `AnalyticsAggregate` no se
 * toca: no contiene datos personales y es lo único que sobrevive.
 */
export async function purgeExpiredAnalyticsEvents(
  prisma: PrismaClient,
  options: { retentionMonths: number; now?: Date; batchSize?: number },
): Promise<number> {
  const cutoff = retentionCutoff(options.now ?? new Date(), options.retentionMonths);
  const batchSize = options.batchSize ?? 5000;
  let total = 0;

  for (;;) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM analytics_events
      WHERE id IN (SELECT id FROM analytics_events WHERE created_at < ${cutoff} LIMIT ${batchSize})`;
    total += deleted;
    if (deleted < batchSize) {
      return total;
    }
  }
}
