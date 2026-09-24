import {
  ANALYTICS_EVENTS_QUEUE,
  ANALYTICS_MAINTENANCE_QUEUE,
  type AnalyticsEventJob,
  processAnalyticsEvent,
  purgeExpiredAnalyticsEvents,
  RETENTION_PURGE_JOB,
} from "@impulza/analytics";
import type { PrismaClient } from "@impulza/database";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

// Consumidores de BullMQ del pipeline de analítica (F3.6, ST §10). La lógica de negocio está en
// `@impulza/analytics`; acá solo se conecta a las colas, se programa la purga y se deja
// telemetría de cada trabajo (ST §16: completados, fallidos y reintentados).

export interface AnalyticsWorkers {
  close(): Promise<void>;
}

export async function startAnalyticsWorkers(options: {
  prisma: PrismaClient;
  connection: ConnectionOptions;
  retentionMonths: number;
}): Promise<AnalyticsWorkers> {
  const { prisma, connection, retentionMonths } = options;

  const eventsWorker = new Worker<AnalyticsEventJob>(
    ANALYTICS_EVENTS_QUEUE,
    async (job) => processAnalyticsEvent(prisma, job.data),
    { connection, concurrency: 5 },
  );

  eventsWorker.on("completed", (job, result) => {
    logger.info("analytics.event.processed", { jobId: job.id, type: job.data.type, result });
  });
  eventsWorker.on("failed", (job, error) => {
    // Tras agotar los reintentos, el job queda en el conjunto "failed" de la cola: es la
    // dead-letter inspeccionable (y reintentable a mano) que pide ST §16.
    logger.error("analytics.event.failed", {
      jobId: job?.id,
      type: job?.data.type,
      attemptsMade: job?.attemptsMade,
      finalAttempt: job ? job.attemptsMade >= (job.opts.attempts ?? 1) : undefined,
      err: error,
    });
  });

  const maintenanceQueue = new Queue(ANALYTICS_MAINTENANCE_QUEUE, { connection });
  // Una vez al día, de madrugada en Chile: idempotente (upsert por id), así cada arranque del
  // worker no apila un programa nuevo.
  await maintenanceQueue.upsertJobScheduler(
    "analytics-retention-daily",
    { pattern: "0 30 3 * * *", tz: "America/Santiago" },
    { name: RETENTION_PURGE_JOB },
  );

  const maintenanceWorker = new Worker(
    ANALYTICS_MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name !== RETENTION_PURGE_JOB) {
        return { skipped: job.name };
      }
      const purged = await purgeExpiredAnalyticsEvents(prisma, { retentionMonths });
      logger.info("analytics.retention.purged", { purged, retentionMonths });
      return { purged };
    },
    { connection, concurrency: 1 },
  );
  maintenanceWorker.on("failed", (job, error) => {
    logger.error("analytics.retention.failed", { jobId: job?.id, err: error });
  });

  return {
    async close() {
      await Promise.all([eventsWorker.close(), maintenanceWorker.close()]);
      await maintenanceQueue.close();
    },
  };
}
