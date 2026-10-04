import { AGENCY_IMPORT_QUEUE, maintainAgencyImports, processAgencyImport, type AgencyImportJob, type AgencyImportOptions } from "@impulza/agency";
import type { EmailAdapter } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

const MAINTENANCE_QUEUE = `${AGENCY_IMPORT_QUEUE}-maintenance`;

export interface AgencyImportWorkers {
  close(): Promise<void>;
}

/**
 * Importación de clientes por CSV (F9.5d, ADR-028 §2): consume la cola `agency-import` que llena la API y crea los clientes (la lógica
 * vive en `@impulza/agency`, para que la API y las pruebas ejerciten el mismo código). Una importación a la vez por proceso: cada fila
 * es una transacción propia y comparten el cupo de clientes del plan, no hay nada que ganar en paralelo.
 *
 * Cada minuto, un mantenimiento retoma las importaciones que quedaron sin avanzar (la cola perdió el trabajo o un worker murió a la mitad)
 * y borra las viejas, que guardan correos de terceros. Que dos procesos coincidan es inocuo: cada fila se reclama antes de crearse.
 */
export async function startAgencyImportWorkers(options: { prisma: PrismaClient; email: EmailAdapter; connection: ConnectionOptions; appBaseUrl: string }): Promise<AgencyImportWorkers> {
  const { prisma, connection } = options;
  const processing: AgencyImportOptions = { email: options.email, appBaseUrl: options.appBaseUrl, log: (event, data) => logger.info(event, data) };

  const worker = new Worker<AgencyImportJob>(AGENCY_IMPORT_QUEUE, (job) => processAgencyImport(prisma, job.data.importId, processing), { connection, concurrency: 1 });
  worker.on("completed", (job, result) => logger.info("agency.import.completed", { jobId: job.id, result }));
  worker.on("failed", (job, error) => logger.error("agency.import.failed", { jobId: job?.id, attemptsMade: job?.attemptsMade, err: error }));

  const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection });
  await maintenanceQueue.upsertJobScheduler("agency-import-maintenance", { every: 60_000 }, { name: "maintain" });
  const maintenanceWorker = new Worker(
    MAINTENANCE_QUEUE,
    async () => {
      const result = await maintainAgencyImports(prisma, processing);
      if (result.resumed > 0 || result.purged > 0) logger.info("agency.import.maintenance", result);
      return result;
    },
    { connection },
  );
  maintenanceWorker.on("failed", (_job, error) => logger.error("agency.import.maintenance_failed", { err: error }));

  return {
    async close() {
      await worker.close();
      await maintenanceWorker.close();
      await maintenanceQueue.close();
    },
  };
}
