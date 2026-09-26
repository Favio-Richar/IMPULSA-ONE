import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { MEDIA_PROCESS_QUEUE, MEDIA_VIDEO_QUEUE, type MediaProcessJob } from "@impulza/storage";
import { Queue } from "bullmq";
import { env } from "../../env.js";
import { MediaController } from "./media.controller.js";
import { MediaService } from "./media.service.js";
import { MEDIA_QUEUE, MEDIA_VIDEO_QUEUE_TOKEN } from "./media.tokens.js";

// Conexión propia de BullMQ por cola, igual que la de analítica (exige maxRetriesPerRequest: null).
const connection = () => ({ url: env.REDIS_URL, maxRetriesPerRequest: null });

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    { provide: MEDIA_QUEUE, useFactory: () => new Queue<MediaProcessJob>(MEDIA_PROCESS_QUEUE, { connection: connection() }) },
    { provide: MEDIA_VIDEO_QUEUE_TOKEN, useFactory: () => new Queue<MediaProcessJob>(MEDIA_VIDEO_QUEUE, { connection: connection() }) },
  ],
  exports: [MediaService],
})
export class MediaModule implements OnApplicationShutdown {
  constructor(
    @Inject(MEDIA_QUEUE) private readonly queue: Queue<MediaProcessJob>,
    @Inject(MEDIA_VIDEO_QUEUE_TOKEN) private readonly videoQueue: Queue<MediaProcessJob>,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.videoQueue.close();
  }
}
