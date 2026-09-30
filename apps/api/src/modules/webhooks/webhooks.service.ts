import { ConflictException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { decryptSecret, encryptSecret } from "@impulza/auth";
import type { WebhookDeliveryDetailResponse, WebhookDeliveryResponse, WebhookEndpointResponse, WebhookSecretResponse } from "@impulza/contracts";
import { WebhookDeliveryStatus, type PrismaClient, type WebhookDelivery, type WebhookEndpoint } from "@impulza/database";
import { MAX_WEBHOOK_ENDPOINTS, WEBHOOK_SAMPLE_DATA, type CreateWebhookEndpointInput, type SendWebhookTestInput, type UpdateWebhookEndpointInput } from "@impulza/validation";
import { createDeliveries, generateWebhookSecret, redeliver, type WebhookDeliveryJob, type WebhookQueueLike } from "@impulza/webhooks";
import type { Queue } from "bullmq";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { WEBHOOK_QUEUE } from "./webhook-events.service.js";

export const WEBHOOK_LIMIT_REACHED = "WEBHOOK_LIMIT_REACHED";
export const WEBHOOK_URL_TAKEN = "WEBHOOK_URL_TAKEN";
export const WEBHOOK_ENDPOINT_INACTIVE = "WEBHOOK_ENDPOINT_INACTIVE";
export const WEBHOOK_DELIVERY_PENDING = "WEBHOOK_DELIVERY_PENDING";
const DELIVERIES_PAGE = 50;
const STATS_WINDOW_MS = 7 * 24 * 3_600_000;

type DeliveryStats = Array<{ endpointId: string; status: WebhookDeliveryStatus; _count: { _all: number } }>;

const unprocessable = (code: string, message: string) =>
  new UnprocessableEntityException({ statusCode: HttpStatus.UNPROCESSABLE_ENTITY, error: "Unprocessable Entity", code, message });

const conflict = (code: string, message: string) => new ConflictException({ statusCode: HttpStatus.CONFLICT, error: "Conflict", code, message });

/**
 * Destinos de webhooks de la organización (F7.2, ADR-017): alta (con el secreto una sola vez),
 * edición, pausa y reanudación, rotación del secreto, prueba, registro de entregas y reenvío. Todo
 * acotado a la organización (ADR-002) y auditado. La URL completa nunca va a la auditoría ni a los
 * logs (puede llevar el token de Zapier o Make): solo su host.
 */
@Injectable()
export class WebhooksService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(WEBHOOK_QUEUE) private readonly queue: Queue<WebhookDeliveryJob>,
    private readonly auditService: AuditService,
  ) {}

  private get queueLike(): WebhookQueueLike {
    return this.queue as unknown as WebhookQueueLike;
  }

  async list(organizationId: string): Promise<WebhookEndpointResponse[]> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    const stats = await this.stats(organizationId);
    return endpoints.map((endpoint) => this.toResponse(endpoint, stats));
  }

  async create(organizationId: string, actorId: string, input: CreateWebhookEndpointInput): Promise<WebhookSecretResponse> {
    const count = await this.prisma.webhookEndpoint.count({ where: { organizationId } });
    if (count >= MAX_WEBHOOK_ENDPOINTS) {
      throw unprocessable(WEBHOOK_LIMIT_REACHED, `Puedes tener hasta ${MAX_WEBHOOK_ENDPOINTS} destinos. Borra uno que ya no uses.`);
    }
    await this.assertUrlFree(organizationId, input.url);
    const secret = generateWebhookSecret();
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        organizationId,
        url: input.url,
        description: input.description ?? null,
        events: input.events,
        secretEncrypted: encryptSecret(secret, env.AUTH_ENCRYPTION_KEY),
        createdById: actorId,
      },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "webhook.created",
      targetType: "WebhookEndpoint",
      targetId: endpoint.id,
      metadata: { host: new URL(endpoint.url).host, events: endpoint.events },
    });
    logger.info("webhooks: destino creado", { organizationId, endpointId: endpoint.id, events: endpoint.events });
    return { endpoint: this.toResponse(endpoint, []), secret };
  }

  async update(organizationId: string, actorId: string, endpointId: string, input: UpdateWebhookEndpointInput): Promise<WebhookEndpointResponse> {
    const current = await this.getOrThrow(organizationId, endpointId);
    if (input.url !== undefined && input.url !== current.url) {
      await this.assertUrlFree(organizationId, input.url, endpointId);
    }
    const resuming = input.active === true && !current.active;
    const pausing = input.active === false && current.active;
    const endpoint = await this.prisma.webhookEndpoint.update({
      where: { id: current.id },
      data: {
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        // Reanudar borra el motivo y la cuenta de fallas: se vuelve a intentar desde cero. Pausar a
        // mano no deja motivo del sistema.
        ...(resuming ? { active: true, disabledReason: null, disabledAt: null, consecutiveFailures: 0 } : {}),
        ...(pausing ? { active: false, disabledReason: null, disabledAt: null } : {}),
      },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: resuming ? "webhook.resumed" : pausing ? "webhook.paused" : "webhook.updated",
      targetType: "WebhookEndpoint",
      targetId: endpoint.id,
      metadata: { fields: Object.keys(input), host: new URL(endpoint.url).host },
    });
    return this.toResponse(endpoint, await this.stats(organizationId, endpoint.id));
  }

  async remove(organizationId: string, actorId: string, endpointId: string): Promise<void> {
    const endpoint = await this.getOrThrow(organizationId, endpointId);
    // Sus entregas se borran en cascada; un trabajo ya encolado no la encuentra y termina.
    await this.prisma.webhookEndpoint.delete({ where: { id: endpoint.id } });
    await this.auditService.record({ organizationId, actorId, action: "webhook.deleted", targetType: "WebhookEndpoint", targetId: endpoint.id, metadata: { host: new URL(endpoint.url).host } });
  }

  /** Secreto nuevo: el anterior deja de valer de inmediato. Se devuelve una sola vez. */
  async rotateSecret(organizationId: string, actorId: string, endpointId: string): Promise<WebhookSecretResponse> {
    await this.getOrThrow(organizationId, endpointId);
    const secret = generateWebhookSecret();
    const endpoint = await this.prisma.webhookEndpoint.update({ where: { id: endpointId }, data: { secretEncrypted: encryptSecret(secret, env.AUTH_ENCRYPTION_KEY) } });
    await this.auditService.record({ organizationId, actorId, action: "webhook.secret_rotated", targetType: "WebhookEndpoint", targetId: endpoint.id });
    return { endpoint: this.toResponse(endpoint, await this.stats(organizationId, endpoint.id)), secret };
  }

  /**
   * Envío de prueba a un destino activo: un `ping` o el **ejemplo** de un evento (datos inventados,
   * `test: true`), para que Zapier o Make aprendan los campos. Aparece en el registro como cualquier otra.
   */
  async sendTest(organizationId: string, actorId: string, endpointId: string, input: SendWebhookTestInput): Promise<WebhookDeliveryResponse> {
    const endpoint = await this.getOrThrow(organizationId, endpointId);
    if (!endpoint.active) {
      throw unprocessable(WEBHOOK_ENDPOINT_INACTIVE, "El destino está pausado o desactivado. Reanúdalo para enviar una prueba.");
    }
    const [deliveryId] = await createDeliveries(this.prisma, this.queueLike, { organizationId, type: input.eventType, data: WEBHOOK_SAMPLE_DATA[input.eventType], endpointIds: [endpoint.id], test: true });
    await this.auditService.record({ organizationId, actorId, action: "webhook.test_sent", targetType: "WebhookEndpoint", targetId: endpoint.id, metadata: { eventType: input.eventType } });
    return this.toDelivery(await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } }));
  }

  async deliveries(organizationId: string, endpointId: string, filter: { status?: WebhookDeliveryStatus }): Promise<WebhookDeliveryResponse[]> {
    await this.getOrThrow(organizationId, endpointId);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { organizationId, endpointId, ...(filter.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: "desc" },
      take: DELIVERIES_PAGE,
    });
    return rows.map((row) => this.toDelivery(row));
  }

  async delivery(organizationId: string, endpointId: string, deliveryId: string): Promise<WebhookDeliveryDetailResponse> {
    const row = await this.getDeliveryOrThrow(organizationId, endpointId, deliveryId);
    return { ...this.toDelivery(row), payload: row.payload };
  }

  /** Reenvío manual: el mismo evento (mismo id), con el ciclo de reintentos completo. */
  async redeliver(organizationId: string, actorId: string, endpointId: string, deliveryId: string): Promise<WebhookDeliveryResponse> {
    const endpoint = await this.getOrThrow(organizationId, endpointId);
    const row = await this.getDeliveryOrThrow(organizationId, endpointId, deliveryId);
    if (!endpoint.active) {
      throw unprocessable(WEBHOOK_ENDPOINT_INACTIVE, "El destino está pausado o desactivado. Reanúdalo para reenviar.");
    }
    if (row.status === WebhookDeliveryStatus.PENDING) {
      throw conflict(WEBHOOK_DELIVERY_PENDING, "Esta entrega todavía se está intentando.");
    }
    await redeliver(this.prisma, this.queueLike, row.id);
    await this.auditService.record({ organizationId, actorId, action: "webhook.redelivered", targetType: "WebhookDelivery", targetId: row.id, metadata: { endpointId, eventType: row.eventType } });
    return this.toDelivery(await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: row.id } }));
  }

  private async assertUrlFree(organizationId: string, url: string, exceptId?: string): Promise<void> {
    const taken = await this.prisma.webhookEndpoint.findFirst({ where: { organizationId, url, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (taken) {
      throw conflict(WEBHOOK_URL_TAKEN, "Ya tienes un destino con esa URL.");
    }
  }

  private async getOrThrow(organizationId: string, endpointId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id: endpointId, organizationId } });
    if (!endpoint) {
      throw new NotFoundException("Destino no encontrado.");
    }
    return endpoint;
  }

  private async getDeliveryOrThrow(organizationId: string, endpointId: string, deliveryId: string): Promise<WebhookDelivery> {
    const row = await this.prisma.webhookDelivery.findFirst({ where: { id: deliveryId, endpointId, organizationId } });
    if (!row) {
      throw new NotFoundException("Entrega no encontrada.");
    }
    return row;
  }

  private async stats(organizationId: string, endpointId?: string): Promise<DeliveryStats> {
    const rows = await this.prisma.webhookDelivery.groupBy({
      by: ["endpointId", "status"],
      where: { organizationId, ...(endpointId ? { endpointId } : {}), createdAt: { gte: new Date(Date.now() - STATS_WINDOW_MS) } },
      _count: { _all: true },
    });
    return rows;
  }

  private toResponse(endpoint: WebhookEndpoint, stats: DeliveryStats): WebhookEndpointResponse {
    const count = (status: WebhookDeliveryStatus) => stats.find((row) => row.endpointId === endpoint.id && row.status === status)?._count._all ?? 0;
    return {
      id: endpoint.id,
      url: endpoint.url,
      description: endpoint.description,
      events: endpoint.events,
      active: endpoint.active,
      disabledReason: endpoint.disabledReason === "gone" || endpoint.disabledReason === "too_many_failures" ? endpoint.disabledReason : null,
      disabledAt: endpoint.disabledAt?.toISOString() ?? null,
      consecutiveFailures: endpoint.consecutiveFailures,
      lastSuccessAt: endpoint.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: endpoint.lastFailureAt?.toISOString() ?? null,
      secretHint: this.secretHint(endpoint),
      deliveriesLast7Days: {
        succeeded: count(WebhookDeliveryStatus.SUCCEEDED),
        failed: count(WebhookDeliveryStatus.FAILED),
        pending: count(WebhookDeliveryStatus.PENDING),
      },
      createdAt: endpoint.createdAt.toISOString(),
      updatedAt: endpoint.updatedAt.toISOString(),
    };
  }

  /** Últimos 4 caracteres, para reconocerlo. Un secreto ilegible (clave cambiada) no rompe el listado. */
  private secretHint(endpoint: WebhookEndpoint): string {
    try {
      return decryptSecret(endpoint.secretEncrypted, env.AUTH_ENCRYPTION_KEY).slice(-4);
    } catch {
      return "····";
    }
  }

  private toDelivery(row: WebhookDelivery): WebhookDeliveryResponse {
    return {
      id: row.id,
      eventId: row.eventId,
      eventType: row.eventType,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
      lastStatusCode: row.lastStatusCode,
      lastError: row.lastError,
      lastDurationMs: row.lastDurationMs,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
