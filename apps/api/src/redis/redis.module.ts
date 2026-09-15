import { Global, Module } from "@nestjs/common";
import { Redis } from "ioredis";
import { env } from "../env.js";

export const REDIS = Symbol("REDIS");

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => new Redis(env.REDIS_URL),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
