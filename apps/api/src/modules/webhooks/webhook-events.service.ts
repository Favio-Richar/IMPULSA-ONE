import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@impulza/database";
import type { WebhookEventType } from "@impulza/validation";
import { buildWebhookData, createDeliveries, type WebhookDeliveryJob, type WebhookQueueLike } from "@impulza/webhooks";
import type { Queue } from "bullmq";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service.js";

export const WEBHOOK_QUEUE = Symbol("WEBHOOK_QUEUE");

/**
 * Emisor de webhooks salientes (F7.2, ADR-017). Se llama **después** de confirmar lo que pasó. Sin
 * destinos activos suscritos no hace más que una consulta. Arma la carga útil con los datos del
 * momento, crea las entregas y las encola para el worker. Nunca lanza: un webhook no puede hacer
 * fallar un contacto, una reserva, un pedido ni un pago.
 */
@Injectable()
export class WebhookEventsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(WEBHOOK_QUEUE) private readonly queue: Queue<WebhookDeliveryJob>,
    private readonly flags: FeatureFlagsService,
  ) {}

  async emit(input: { organizationId: string; type: WebhookEventType; subjectId: string }): Promise<void> {
    try {
      // Apagado por el superadministrador (bandera `webhooks_salientes`): no se emite ni se encola nada.
      if (!(await this.flags.isEnabled("webhooks_salientes", input.organizationId))) return;
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { organizationId: input.organizationId, active: true, events: { has: input.type } },
        select: { id: true },
      });
      if (endpoints.length === 0) return;
      const data = await buildWebhookData(this.prisma, input.organizationId, input.type, input.subjectId);
      if (data === null) return;
      const created = await createDeliveries(this.prisma, this.queue as unknown as WebhookQueueLike, {
        organizationId: input.organizationId,
        type: input.type,
        data,
        endpointIds: endpoints.map((endpoint) => endpoint.id),
      });
      logger.info("webhooks: evento encolado", { organizationId: input.organizationId, type: input.type, deliveries: created.length });
    } catch (error) {
      logger.error("webhooks: no se pudo encolar un evento", { organizationId: input.organizationId, type: input.type, err: error });
    }
  }
}
