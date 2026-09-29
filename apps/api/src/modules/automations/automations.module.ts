import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { AUTOMATION_EVENTS_QUEUE, type AutomationEventJob } from "@impulza/validation";
import { Queue } from "bullmq";
import { env } from "../../env.js";
import { AUTOMATION_QUEUE, AutomationEventsService } from "./automation-events.service.js";
import { AutomationsController } from "./automations.controller.js";
import { AutomationsService } from "./automations.service.js";

// Automatizaciones (F6.7). Contactos, reservas y catálogo importan este módulo para emitir eventos;
// Nest lo instancia una sola vez.
@Module({
  controllers: [AutomationsController],
  providers: [
    AutomationsService,
    AutomationEventsService,
    {
      provide: AUTOMATION_QUEUE,
      // Conexión propia de BullMQ (exige `maxRetriesPerRequest: null`), como la de analítica.
      useFactory: () => new Queue<AutomationEventJob>(AUTOMATION_EVENTS_QUEUE, { connection: { url: env.REDIS_URL, maxRetriesPerRequest: null } }),
    },
  ],
  exports: [AutomationEventsService],
})
export class AutomationsModule implements OnApplicationShutdown {
  constructor(@Inject(AUTOMATION_QUEUE) private readonly queue: Queue<AutomationEventJob>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
