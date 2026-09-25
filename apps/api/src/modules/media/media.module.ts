import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { MEDIA_PROCESS_QUEUE, type MediaProcessJob } from "@impulza/storage";
import { Queue } from "bullmq";
import { env } from "../../env.js";
import { MediaController } from "./media.controller.js";
import { MediaService } from "./media.service.js";
import { MEDIA_QUEUE } from "./media.tokens.js";

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: MEDIA_QUEUE,
      // Conexión propia de BullMQ, igual que la cola de analítica (exige maxRetriesPerRequest: null).
      useFactory: () => new Queue<MediaProcessJob>(MEDIA_PROCESS_QUEUE, { connection: { url: env.REDIS_URL, maxRetriesPerRequest: null } }),
    },
  ],
  exports: [MediaService],
})
export class MediaModule implements OnApplicationShutdown {
  constructor(@Inject(MEDIA_QUEUE) private readonly queue: Queue<MediaProcessJob>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
