import { decryptSecret, type EmailAdapter } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import {
  buildWebhookData,
  enqueueWebhookEvent,
  maintainWebhookDeliveries,
  processWebhookDelivery,
  WEBHOOKS_QUEUE,
  type ProcessDeps,
  type WebhookDeliveryJob,
  type WebhookQueueLike,
} from "@impulza/webhooks";
import type { WebhookEventType } from "@impulza/validation";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

const MAINTAIN_JOB = "maintain-deliveries";

export interface WebhookWorkerOptions {
  prisma: PrismaClient;
  email: EmailAdapter;
  connection: ConnectionOptions;
  encryptionKey: string;
  dashboardBaseUrl?: string;
}

/** Correo al dueño cuando el sistema desactiva un destino (ADR-017 §3). Sin la URL: puede llevar un token. */
export function webhookDisabledEmail(input: { organizationName: string; host: string; reason: "gone" | "too_many_failures"; dashboardBaseUrl?: string }): { subject: string; text: string } {
  const link = input.dashboardBaseUrl ? `${input.dashboardBaseUrl.replace(/\/+$/, "")}/integraciones` : null;
  const why =
    input.reason === "gone"
      ? `El destino en ${input.host} respondió que ya no existe (410), así que dejamos de enviarle eventos.`
      : `El destino en ${input.host} falló en las últimas 15 entregas seguidas, así que lo pausamos para no seguir insistiendo.`;
  return {
    subject: "Desactivamos un webhook de tu cuenta",
    text: [
      `Hola, ${input.organizationName}:`,
      "",
      why,
      "",
      "Los eventos de este tiempo no se pierden de tu panel: puedes revisar el registro de entregas, corregir la URL y reanudarlo desde \"Integraciones\".",
      ...(link ? ["", `Integraciones: ${link}`] : []),
    ].join("\n"),
  };
}

export function webhookProcessDeps(options: WebhookWorkerOptions, queue: WebhookQueueLike): ProcessDeps {
  return {
    prisma: options.prisma,
    queue,
    decryptSecret: (encrypted) => decryptSecret(encrypted, options.encryptionKey),
    onEndpointDisabled: async (endpoint) => {
      logger.warn("webhooks.endpoint.disabled", { organizationId: endpoint.organizationId, endpointId: endpoint.id, reason: endpoint.reason });
      const organization = await options.prisma.organization.findUnique({ where: { id: endpoint.organizationId }, select: { name: true } });
      const owners = await options.prisma.membership.findMany({
        where: { organizationId: endpoint.organizationId, status: "ACTIVE", role: { name: "OWNER" } },
        select: { user: { select: { email: true } } },
      });
      const content = webhookDisabledEmail({ organizationName: organization?.name ?? "", host: new URL(endpoint.url).host, reason: endpoint.reason, dashboardBaseUrl: options.dashboardBaseUrl });
      for (const owner of owners) {
        await options.email.send({ to: owner.user.email, subject: content.subject, text: content.text }).catch(() => undefined);
      }
    },
  };
}

/**
 * Emite un evento desde el worker (hoy: la reserva que se cancela sola porque venció la seña).
 * Nunca lanza, igual que en la API.
 */
export async function emitWebhookEvent(prisma: PrismaClient, queue: WebhookQueueLike, input: { organizationId: string; type: WebhookEventType; subjectId: string }): Promise<void> {
  try {
    const hasEndpoints = await prisma.webhookEndpoint.count({ where: { organizationId: input.organizationId, active: true, events: { has: input.type } } });
    if (hasEndpoints === 0) return;
    const data = await buildWebhookData(prisma, input.organizationId, input.type, input.subjectId);
    if (data === null) return;
    await enqueueWebhookEvent(prisma, queue, { organizationId: input.organizationId, type: input.type, data });
  } catch (error) {
    logger.error("webhooks.emit_failed", { organizationId: input.organizationId, type: input.type, err: error });
  }
}

export interface WebhookWorkers {
  /** Cola para emitir eventos desde otros procesos del worker. */
  queue: WebhookQueueLike;
  close(): Promise<void>;
}

/**
 * Entregas de webhooks (F7.2, ADR-017). Cada trabajo es **un intento**: los reintentos los programa
 * `processWebhookDelivery` con su propio calendario (no los de BullMQ), así el registro muestra cada
 * intento y un reenvío manual reinicia el ciclo. Cada hora: reencola entregas colgadas y borra las
 * de más de 30 días.
 */
export async function startWebhookWorkers(options: WebhookWorkerOptions): Promise<WebhookWorkers> {
  const queue = new Queue<WebhookDeliveryJob>(WEBHOOKS_QUEUE, { connection: options.connection });
  const queueLike = queue as unknown as WebhookQueueLike;
  await queue.upsertJobScheduler("webhooks-maintain-hourly", { pattern: "0 15 * * * *" }, { name: MAINTAIN_JOB, data: { deliveryId: "" } });
  const deps = webhookProcessDeps(options, queueLike);
  const worker = new Worker<WebhookDeliveryJob>(
    WEBHOOKS_QUEUE,
    async (job) => {
      if (job.name === MAINTAIN_JOB) {
        const result = await maintainWebhookDeliveries(options.prisma, queueLike);
        if (result.requeued > 0 || result.purged > 0) logger.info("webhooks.maintained", result);
        return result;
      }
      const outcome = await processWebhookDelivery(deps, job.data.deliveryId);
      logger.info("webhooks.delivery", { deliveryId: job.data.deliveryId, outcome });
      return outcome;
    },
    // Un destino lento (hasta 10 s) no frena al resto.
    { connection: options.connection, concurrency: 10 },
  );
  worker.on("failed", (job, error) => logger.error("webhooks.job_failed", { jobId: job?.id, err: error }));
  return {
    queue: queueLike,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
