import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { REPORT_RUN_MAX_ATTEMPTS, ReportScheduleService } from "./report-schedule.service.js";

export const REPORT_SCHEDULE_QUEUE = "report-schedules";
const TICK_EVERY_MS = 60_000;

type Job = { runId?: string };

/**
 * Consumidor de la cola de informes programados (F9.8c). Vive en la API porque el informe se arma con sus servicios (analítica,
 * reservas, pedidos, planes y marca); la lógica y la idempotencia están en `ReportScheduleService`, que es lo que se prueba.
 *
 * Un trabajo repetible (`tick`, cada minuto) convierte en ejecuciones las programaciones vencidas y encola una tarea por ejecución con
 * `jobId` igual a la ejecución: encolarla dos veces no la duplica. Cada tarea reintenta con espera creciente. Que varias réplicas de la
 * API consuman es inocuo: reclamar la programación y el estado de la ejecución son atómicos. Se apaga con `REPORT_SCHEDULER_DISABLED=true`.
 */
@Injectable()
export class ReportScheduleRunner implements OnModuleInit, OnModuleDestroy {
  private queue: Queue<Job> | null = null;
  private worker: Worker<Job> | null = null;

  constructor(private readonly schedules: ReportScheduleService) {}

  async onModuleInit(): Promise<void> {
    // Las pruebas ejercitan el servicio directamente; un consumidor real compartiría la cola con el entorno de desarrollo.
    if (process.env.VITEST || process.env.REPORT_SCHEDULER_DISABLED === "true") return;
    const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };
    this.queue = new Queue<Job>(REPORT_SCHEDULE_QUEUE, { connection });
    await this.queue.upsertJobScheduler("report-schedules-tick", { every: TICK_EVERY_MS }, { name: "tick" });
    this.worker = new Worker<Job>(
      REPORT_SCHEDULE_QUEUE,
      async (job) => {
        if (job.name === "tick") {
          for (const runId of await this.schedules.runDue()) {
            await this.queue?.add(
              "run",
              { runId },
              { jobId: `run-${runId}`, attempts: REPORT_RUN_MAX_ATTEMPTS, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: true, removeOnFail: true },
            );
          }
          return;
        }
        if (job.data.runId) await this.schedules.processRun(job.data.runId);
      },
      { connection, concurrency: 1 },
    );
    this.worker.on("failed", (job, error) => logger.warn("report.schedule.job_failed", { jobId: job?.id, attemptsMade: job?.attemptsMade, error: error.message }));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
