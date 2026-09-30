import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, WebhookDeliveryStatus } from "@impulza/database";
import { WEBHOOK_API_VERSION, type WebhookDeliveredEvent, type WebhookEnvelope, type WebhookEventType } from "@impulza/validation";
import type { WebhookDeliveryJob } from "./job.js";
import { CONSECUTIVE_FAILURES_TO_DISABLE, DELIVERY_RETENTION_DAYS, isGone, MAX_ATTEMPTS, retryDelayMs } from "./schedule.js";
import { sendWebhook, type SendOptions, type SendResult } from "./sender.js";
import { SIGNATURE_HEADER, signWebhook } from "./signature.js";

/** Lo que se necesita de una cola de BullMQ (así las pruebas pasan una en memoria). */
export interface WebhookQueueLike {
  add(name: string, data: WebhookDeliveryJob, options: { jobId: string; delay?: number; removeOnComplete?: number | boolean; removeOnFail?: number | boolean }): Promise<unknown>;
}

function enqueueAttempt(queue: WebhookQueueLike, deliveryId: string, suffix: string, delay = 0): Promise<unknown> {
  // BullMQ no admite `:` en un id propio. Un id por intento: el mismo intento encolado dos veces es uno.
  return queue.add("deliver", { deliveryId }, { jobId: `wh-${deliveryId}-${suffix}`, delay, removeOnComplete: 1000, removeOnFail: 5000 });
}

/**
 * Crea una entrega por cada destino activo suscrito al evento y las encola (ADR-017). La carga útil
 * se arma **ahora** (los datos del momento del evento) con un id de evento compartido. Devuelve
 * cuántas entregas creó. El que llama decide qué hacer si esto falla (nunca debe hacer fallar la
 * operación que originó el evento).
 */
export async function enqueueWebhookEvent(
  prisma: PrismaClient,
  queue: WebhookQueueLike,
  input: { organizationId: string; type: WebhookEventType; data: unknown; now?: Date },
): Promise<number> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { organizationId: input.organizationId, active: true, events: { has: input.type } },
    select: { id: true },
  });
  if (endpoints.length === 0) return 0;
  const ids = await createDeliveries(prisma, queue, { organizationId: input.organizationId, type: input.type, data: input.data, endpointIds: endpoints.map((e) => e.id), now: input.now });
  return ids.length;
}

/** Entregas de un evento a destinos dados (también el `ping` de prueba, a un solo destino). Devuelve sus ids. */
export async function createDeliveries(
  prisma: PrismaClient,
  queue: WebhookQueueLike,
  input: { organizationId: string; type: WebhookDeliveredEvent; data: unknown; endpointIds: string[]; test?: boolean; now?: Date },
): Promise<string[]> {
  const now = input.now ?? new Date();
  const envelope: WebhookEnvelope = { id: randomUUID(), type: input.type, apiVersion: WEBHOOK_API_VERSION, createdAt: now.toISOString(), organizationId: input.organizationId, test: input.test ?? false, data: input.data };
  const ids: string[] = [];
  for (const endpointId of input.endpointIds) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        organizationId: input.organizationId,
        endpointId,
        eventId: envelope.id,
        eventType: input.type,
        payload: envelope as unknown as Prisma.InputJsonValue,
        nextAttemptAt: now,
      },
    });
    await enqueueAttempt(queue, delivery.id, "1");
    ids.push(delivery.id);
  }
  return ids;
}

/** Vuelve a intentar una entrega (reenvío manual): ciclo de reintentos completo desde cero. */
export async function redeliver(prisma: PrismaClient, queue: WebhookQueueLike, deliveryId: string, now = new Date()): Promise<void> {
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: { status: WebhookDeliveryStatus.PENDING, attempts: 0, nextAttemptAt: now, deliveredAt: null },
  });
  await enqueueAttempt(queue, deliveryId, `r${now.getTime()}`);
}

export interface ProcessDeps {
  prisma: PrismaClient;
  queue: WebhookQueueLike;
  /** Descifra el secreto guardado (`decryptSecret` con `AUTH_ENCRYPTION_KEY`). */
  decryptSecret: (encrypted: string) => string;
  /** Solo pruebas: reemplaza el envío real (o permite red privada con `unsafeAllowPrivateNetwork`). */
  send?: (options: SendOptions) => Promise<SendResult>;
  /** Aviso a los dueños cuando el sistema desactiva un destino. Nunca debe lanzar. */
  onEndpointDisabled?: (endpoint: { id: string; organizationId: string; url: string; reason: "gone" | "too_many_failures" }) => Promise<void>;
  now?: () => Date;
}

export type ProcessResult = "delivered" | "retry_scheduled" | "failed" | "skipped" | "not_pending" | "missing";

/**
 * Procesa un intento de entrega. Primero lo **reclama** con una actualización condicional (estado
 * `PENDING` y el número de intentos leído): dos trabajos a la vez para la misma entrega nunca envían
 * dos veces. Después firma, envía y registra; programa el reintento o cierra la entrega y lleva la
 * cuenta de fallas seguidas del destino (que lo desactiva al llegar al tope, o de inmediato con 410).
 */
export async function processWebhookDelivery(deps: ProcessDeps, deliveryId: string): Promise<ProcessResult> {
  const now = deps.now ?? (() => new Date());
  const delivery = await deps.prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } });
  if (!delivery) return "missing";
  if (delivery.status !== WebhookDeliveryStatus.PENDING) return "not_pending";
  if (!delivery.endpoint.active) {
    await deps.prisma.webhookDelivery.updateMany({ where: { id: delivery.id, status: WebhookDeliveryStatus.PENDING }, data: { status: WebhookDeliveryStatus.SKIPPED, nextAttemptAt: null } });
    return "skipped";
  }

  const attempt = delivery.attempts + 1;
  const claimed = await deps.prisma.webhookDelivery.updateMany({
    where: { id: delivery.id, status: WebhookDeliveryStatus.PENDING, attempts: delivery.attempts },
    // `nextAttemptAt` = ahora: si el proceso muere a mitad del envío, el mantenimiento la retoma.
    data: { attempts: attempt, nextAttemptAt: now() },
  });
  if (claimed.count === 0) return "not_pending";

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(now().getTime() / 1000);
  const secret = deps.decryptSecret(delivery.endpoint.secretEncrypted);
  const result = await (deps.send ?? sendWebhook)({
    url: delivery.endpoint.url,
    body,
    headers: {
      [SIGNATURE_HEADER]: signWebhook(secret, body, timestamp),
      "Impulza-Event-Id": delivery.eventId,
      "Impulza-Event-Type": delivery.eventType,
      "Impulza-Delivery-Id": delivery.id,
      "User-Agent": "Impulza-Webhooks/1.0",
    },
  });
  const last = { lastStatusCode: result.status, lastError: result.error, lastDurationMs: result.durationMs };

  if (result.ok) {
    await deps.prisma.$transaction([
      deps.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { ...last, status: WebhookDeliveryStatus.SUCCEEDED, deliveredAt: now(), nextAttemptAt: null } }),
      deps.prisma.webhookEndpoint.update({ where: { id: delivery.endpointId }, data: { consecutiveFailures: 0, lastSuccessAt: now() } }),
    ]);
    return "delivered";
  }

  if (isGone(result.status)) {
    await deps.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { ...last, status: WebhookDeliveryStatus.FAILED, nextAttemptAt: null } });
    await disableEndpoint(deps, delivery.endpoint, "gone", now());
    return "failed";
  }

  const delay = retryDelayMs(attempt + 1);
  if (delay !== null && attempt < MAX_ATTEMPTS) {
    const nextAttemptAt = new Date(now().getTime() + delay);
    await deps.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { ...last, nextAttemptAt } });
    await enqueueAttempt(deps.queue, delivery.id, String(attempt + 1), delay);
    return "retry_scheduled";
  }

  // Intentos agotados: una falla más del destino.
  await deps.prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { ...last, status: WebhookDeliveryStatus.FAILED, nextAttemptAt: null } });
  const endpoint = await deps.prisma.webhookEndpoint.update({
    where: { id: delivery.endpointId },
    data: { consecutiveFailures: { increment: 1 }, lastFailureAt: now() },
  });
  if (endpoint.consecutiveFailures >= CONSECUTIVE_FAILURES_TO_DISABLE) {
    await disableEndpoint(deps, endpoint, "too_many_failures", now());
  }
  return "failed";
}

async function disableEndpoint(deps: ProcessDeps, endpoint: { id: string; organizationId: string; url: string }, reason: "gone" | "too_many_failures", at: Date): Promise<void> {
  // Condicional: solo el primero que lo desactiva avisa.
  const changed = await deps.prisma.webhookEndpoint.updateMany({ where: { id: endpoint.id, active: true }, data: { active: false, disabledReason: reason, disabledAt: at } });
  if (changed.count === 1) {
    await deps.onEndpointDisabled?.({ id: endpoint.id, organizationId: endpoint.organizationId, url: endpoint.url, reason }).catch(() => undefined);
  }
}

/**
 * Mantenimiento (worker, cada hora): vuelve a encolar entregas pendientes cuyo intento debió correr
 * hace más de 10 minutos (un trabajo perdido en Redis no deja una entrega colgada) y borra las
 * entregas de más de 30 días (datos personales, ADR-004). `organizationId` solo en pruebas.
 */
export async function maintainWebhookDeliveries(prisma: PrismaClient, queue: WebhookQueueLike, now = new Date(), scope: { organizationId?: string } = {}): Promise<{ requeued: number; purged: number }> {
  const scoped = scope.organizationId ? { organizationId: scope.organizationId } : {};
  const stuck = await prisma.webhookDelivery.findMany({
    where: { ...scoped, status: WebhookDeliveryStatus.PENDING, nextAttemptAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    select: { id: true, attempts: true },
    take: 500,
  });
  for (const delivery of stuck) {
    await enqueueAttempt(queue, delivery.id, `s${delivery.attempts + 1}-${now.getTime()}`);
  }
  const purged = await prisma.webhookDelivery.deleteMany({ where: { ...scoped, createdAt: { lt: new Date(now.getTime() - DELIVERY_RETENTION_DAYS * 24 * 3_600_000) } } });
  return { requeued: stuck.length, purged: purged.count };
}

