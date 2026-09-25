import type { PrismaClient } from "@impulza/database";
import { cleanupAbandonedMedia, MEDIA_PROCESS_QUEUE, type MediaProcessJob, processMediaAsset, type StorageAdapter } from "@impulza/storage";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

const MEDIA_MAINTENANCE_JOB = "media-cleanup";

export interface MediaWorkers {
  close(): Promise<void>;
}

/**
 * Consumidores de medios (ADR-006 §4). Sin almacenamiento configurado no se levantan: la API tampoco
 * emite URLs de subida en ese caso, así que la cola queda vacía.
 */
export async function startMediaWorkers(options: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  connection: ConnectionOptions;
}): Promise<MediaWorkers> {
  const { prisma, storage, connection } = options;

  // Concurrencia baja a propósito: re-codificar imágenes es CPU pura, y este proceso también atiende
  // la ingesta de analítica.
  const processWorker = new Worker<MediaProcessJob>(MEDIA_PROCESS_QUEUE, async (job) => processMediaAsset(prisma, storage, job.data.assetId), {
    connection,
    concurrency: 2,
  });
  processWorker.on("completed", (job, result) => {
    logger.info("media.asset.processed", { jobId: job.id, assetId: job.data.assetId, result });
  });
  processWorker.on("failed", (job, error) => {
    logger.error("media.asset.failed", { jobId: job?.id, assetId: job?.data.assetId, attemptsMade: job?.attemptsMade, err: error });
  });

  const maintenanceQueue = new Queue(`${MEDIA_PROCESS_QUEUE}-maintenance`, { connection });
  await maintenanceQueue.upsertJobScheduler("media-cleanup-hourly", { pattern: "0 15 * * * *" }, { name: MEDIA_MAINTENANCE_JOB });
  const maintenanceWorker = new Worker(
    `${MEDIA_PROCESS_QUEUE}-maintenance`,
    async () => {
      const removed = await cleanupAbandonedMedia(prisma, storage);
      logger.info("media.cleanup", { removed });
      return removed;
    },
    { connection },
  );

  return {
    async close() {
      await processWorker.close();
      await maintenanceWorker.close();
      await maintenanceQueue.close();
    },
  };
}

