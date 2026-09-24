import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ANALYTICS_EVENTS_QUEUE, type AnalyticsEventJob } from "@impulza/analytics";
import { Queue } from "bullmq";
import { env } from "../../env.js";
import { AnalyticsService } from "./analytics.service.js";
import { ANALYTICS_QUEUE } from "./analytics.tokens.js";

@Module({
  providers: [
    {
      provide: ANALYTICS_QUEUE,
      // Conexión propia de BullMQ (no el cliente REDIS compartido del rate limit): BullMQ exige
      // `maxRetriesPerRequest: null` y maneja su propio ciclo de vida de conexión.
      useFactory: () =>
        new Queue<AnalyticsEventJob>(ANALYTICS_EVENTS_QUEUE, {
          connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
        }),
    },
    AnalyticsService,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule implements OnApplicationShutdown {
  constructor(@Inject(ANALYTICS_QUEUE) private readonly queue: Queue<AnalyticsEventJob>) {}

  // Sin esto, `app.close()` deja viva la conexión de la cola y el proceso (o la corrida de
  // pruebas) no termina.
  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
