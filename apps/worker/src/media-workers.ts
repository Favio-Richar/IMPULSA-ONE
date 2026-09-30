import type { PrismaClient } from "@impulza/database";
import {
  cleanupAbandonedMedia,
  cleanupAbandonedProductFiles,
  MEDIA_PROCESS_QUEUE,
  MEDIA_VIDEO_QUEUE,
  type MediaProcessJob,
  processMediaAsset,
  type StorageAdapter,
  type VideoToolsConfig,
} from "@impulza/storage";
import { type ConnectionOptions, type Job, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

const MEDIA_MAINTENANCE_JOB = "media-cleanup";

export interface MediaWorkers {
  close(): Promise<void>;
}

/**
 * Consumidores de medios (ADR-006 §4). Sin almacenamiento configurado no se levantan: la API tampoco
 * emite URLs de subida en ese caso, así que la cola queda vacía. La cola de video (PP6, ADR-007) se
 * levanta solo si además hay ffmpeg configurado — la API aplica la misma regla para aceptar videos.
 */
export async function startMediaWorkers(options: {
  prisma: PrismaClient;
  storage: StorageAdapter;
  /** Bucket privado de archivos en venta (F5.11b, ADR-015); su limpieza va en el mismo trabajo. */
  privateStorage: StorageAdapter | null;
  connection: ConnectionOptions;
  videoTools: VideoToolsConfig | null;
}): Promise<MediaWorkers> {
  const { prisma, storage, privateStorage, connection, videoTools } = options;

  const processJob = (job: Job<MediaProcessJob>) =>
    processMediaAsset(prisma, storage, job.data.assetId, {
      videoTools,
      onError: (error) => logger.warn("media.asset.rejected", { jobId: job.id, assetId: job.data.assetId, err: error }),
    });
  const observe = (worker: Worker<MediaProcessJob>) => {
    worker.on("completed", (job, result) => {
      logger.info("media.asset.processed", { queue: worker.name, jobId: job.id, assetId: job.data.assetId, result });
    });
    worker.on("failed", (job, error) => {
      logger.error("media.asset.failed", { queue: worker.name, jobId: job?.id, assetId: job?.data.assetId, attemptsMade: job?.attemptsMade, err: error });
    });
    return worker;
  };

  // Concurrencia baja a propósito: re-codificar imágenes es CPU pura, y este proceso también atiende
  // la ingesta de analítica.
  const imageWorker = observe(new Worker<MediaProcessJob>(MEDIA_PROCESS_QUEUE, processJob, { connection, concurrency: 2 }));
  // Un video a la vez: convertir video es mucho más pesado, y en su propia cola no demora las fotos.
  // `lockDuration` por encima del tope de ffmpeg (3 min): una conversión larga nunca se da por
  // "estancada" ni se ejecuta dos veces.
  const videoWorker = videoTools
    ? observe(new Worker<MediaProcessJob>(MEDIA_VIDEO_QUEUE, processJob, { connection, concurrency: 1, lockDuration: 5 * 60_000 }))
    : null;

  const maintenanceQueue = new Queue(`${MEDIA_PROCESS_QUEUE}-maintenance`, { connection });
  await maintenanceQueue.upsertJobScheduler("media-cleanup-hourly", { pattern: "0 15 * * * *" }, { name: MEDIA_MAINTENANCE_JOB });
  const maintenanceWorker = new Worker(
    `${MEDIA_PROCESS_QUEUE}-maintenance`,
    async () => {
      const removed = await cleanupAbandonedMedia(prisma, storage);
      const removedFiles = privateStorage ? await cleanupAbandonedProductFiles(prisma, privateStorage) : 0;
      logger.info("media.cleanup", { removed, removedProductFiles: removedFiles });
      return removed + removedFiles;
    },
    { connection },
  );

  return {
    async close() {
      await imageWorker.close();
      await videoWorker?.close();
      await maintenanceWorker.close();
      await maintenanceQueue.close();
    },
  };
}
