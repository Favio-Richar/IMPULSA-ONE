import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { WEBHOOKS_QUEUE, type WebhookDeliveryJob } from "@impulza/webhooks";
import { Queue } from "bullmq";
import { env } from "../../env.js";
import { WEBHOOK_QUEUE, WebhookEventsService } from "./webhook-events.service.js";
import { WebhooksController } from "./webhooks.controller.js";
import { WebhooksService } from "./webhooks.service.js";

// Webhooks salientes (F7.2, ADR-017). Global: contactos, reservas, pedidos y cobros emiten eventos
// sin importar el módulo en cada uno (mismo criterio que la auditoría).
@Global()
@Module({
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookEventsService,
    {
      provide: WEBHOOK_QUEUE,
      // Conexión propia de BullMQ (exige `maxRetriesPerRequest: null`), como la de automatizaciones.
      useFactory: () => new Queue<WebhookDeliveryJob>(WEBHOOKS_QUEUE, { connection: { url: env.REDIS_URL, maxRetriesPerRequest: null } }),
    },
  ],
  exports: [WebhookEventsService],
})
export class WebhooksModule implements OnApplicationShutdown {
  constructor(@Inject(WEBHOOK_QUEUE) private readonly queue: Queue<WebhookDeliveryJob>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
