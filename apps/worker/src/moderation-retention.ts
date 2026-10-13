import type { PrismaClient } from "@impulza/database";
import { purgeExpiredAbuseReportReporterEmails } from "@impulza/database";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

export const MODERATION_RETENTION_QUEUE = "moderation-retention-maintenance";

export interface ModerationRetentionWorkers {
  close(): Promise<void>;
}

/**
 * Minimización del correo del denunciante (F9.9, decisión del propietario 2026-10-13): una vez
 * cerrado el caso (`resolvedAt`), el correo opcional que dejó solo servía para que el equipo le
 * pidiera contexto durante la revisión -- pasados 90 días se borra. El reporte y su decisión
 * **nunca se borran** (la lógica vive en `@impulza/database` y la ejercita también la prueba de
 * ese paquete contra Postgres real).
 */
export async function startModerationRetentionWorkers(options: {
  prisma: PrismaClient;
  connection: ConnectionOptions;
  reporterEmailRetentionDays: number;
}): Promise<ModerationRetentionWorkers> {
  const { prisma, connection, reporterEmailRetentionDays } = options;

  const queue = new Queue(MODERATION_RETENTION_QUEUE, { connection });
  // Una pasada diaria, de madrugada en Chile (desfasada de las otras tareas de retención para no
  // competir por el mismo minuto).
  await queue.upsertJobScheduler("moderation-retention-daily", { pattern: "0 0 4 * * *", tz: "America/Santiago" }, { name: "purge-reporter-emails" });

  const worker = new Worker(
    MODERATION_RETENTION_QUEUE,
    async () => {
      const result = await purgeExpiredAbuseReportReporterEmails(prisma, { days: reporterEmailRetentionDays });
      if (result.purged > 0) logger.info("moderation.retention.purged", { ...result, reporterEmailRetentionDays });
      return result;
    },
    { connection },
  );
  worker.on("failed", (job, error) => logger.error("moderation.retention.failed", { jobId: job?.id, err: error }));

  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
