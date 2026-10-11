import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { MembershipLifecycleService } from "./membership-lifecycle.service.js";

export const MEMBERSHIP_LIFECYCLE_QUEUE = "membership-lifecycle";
const TICK_EVERY_MS = 60 * 60_000;

/**
 * Consumidor de los avisos de membresía (F10.2b). Vive en la API porque arma el correo con la marca del negocio; la lógica y la
 * idempotencia están en `MembershipLifecycleService`, que es lo que se prueba. Un trabajo repetible (`tick`, cada hora) revisa lo
 * pendiente; que varias réplicas lo ejecuten es inocuo (cada aviso se reclama de forma condicional). Se apaga con
 * `MEMBERSHIP_SCHEDULER_DISABLED=true` y no arranca bajo Vitest.
 */
@Injectable()
export class MembershipLifecycleRunner implements OnModuleInit, OnModuleDestroy {
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly lifecycle: MembershipLifecycleService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.VITEST || process.env.MEMBERSHIP_SCHEDULER_DISABLED === "true") return;
    const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };
    this.queue = new Queue(MEMBERSHIP_LIFECYCLE_QUEUE, { connection });
    await this.queue.upsertJobScheduler("membership-lifecycle-tick", { every: TICK_EVERY_MS }, { name: "tick" });
    this.worker = new Worker(
      MEMBERSHIP_LIFECYCLE_QUEUE,
      async () => {
        await this.lifecycle.runDue();
      },
      { connection, concurrency: 1 },
    );
    this.worker.on("failed", (job, error) => logger.warn("membership.lifecycle.job_failed", { jobId: job?.id, attemptsMade: job?.attemptsMade, error: error.message }));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
