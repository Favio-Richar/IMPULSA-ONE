import { ANALYTICS_EVENTS_QUEUE, type AnalyticsEventJob, processAnalyticsEvent } from "@impulza/analytics";
import type { PrismaClient } from "@impulza/database";
import { Queue, Worker } from "bullmq";
import { env } from "../env.js";

/** Un user-agent de navegador real: sin esto, supertest no manda ninguno y el pipeline (F3.6) lo
 *  descarta como bot antes de encolar. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/**
 * El mismo consumidor que corre `apps/worker` en producción (`processAnalyticsEvent` de
 * `@impulza/analytics`), levantado dentro de la prueba contra la cola real de Redis. Así las
 * pruebas de la API ejercitan el pipeline completo — endpoint → cola → worker → Postgres — y no
 * una escritura directa que en producción ya no existe.
 */
export function startAnalyticsTestWorker(prisma: PrismaClient): {
  drain: () => Promise<void>;
  close: () => Promise<void>;
} {
  const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };
  const worker = new Worker<AnalyticsEventJob>(
    ANALYTICS_EVENTS_QUEUE,
    async (job) => processAnalyticsEvent(prisma, job.data),
    { connection, concurrency: 5 },
  );
  const queue = new Queue(ANALYTICS_EVENTS_QUEUE, { connection });

  return {
    /** Espera a que no quede nada pendiente ni en proceso en la cola. */
    async drain() {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const counts = await queue.getJobCounts("waiting", "active", "delayed", "prioritized");
        if (Object.values(counts).every((count) => count === 0)) {
          return;
        }
        if (Date.now() > deadline) {
          throw new Error(`La cola de analítica no se vació a tiempo: ${JSON.stringify(counts)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
