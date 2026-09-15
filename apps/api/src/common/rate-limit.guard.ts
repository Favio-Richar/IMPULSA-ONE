import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Redis } from "ioredis";
import { REDIS } from "../redis/redis.module.js";
import { RATE_LIMIT_KEY, type RateLimitOptions } from "./rate-limit.decorator.js";

// Rate limiting por IP respaldado en Redis (ST §3.3/§15) — ventana fija vía INCR + EXPIRE.
// Deliberadamente no se usa @nestjs/throttler: su última versión estable (6.5.0) declara
// soporte de peer dependencies solo hasta @nestjs/core ^11, y este proyecto usa Nest 12
// (ver README "Decisiones de versión").
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    // @Inject explícito: emitDecoratorMetadata no siempre resuelve el tipo implícito de
    // parámetros bajo runners basados en esbuild (tsx) — funciona con tsc/Vitest pero rompe en
    // `pnpm dev`. Explícito es correcto en cualquier transform, no solo un workaround puntual.
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const key = `ratelimit:${options.keyPrefix}:${ip}`;

    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, options.windowSeconds);
    }

    if (count > options.limit) {
      throw new HttpException(
        "Demasiadas solicitudes. Intenta de nuevo más tarde.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
