import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { PrismaClient } from "@impulza/database";
import { runHealthChecks, type HealthReport } from "@impulza/observability";
import type { Response } from "express";
import type { Redis } from "ioredis";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";

// Sin guards a propósito: un probe de infraestructura (load balancer, orquestador) no tiene
// sesión ni cabecera CSRF. No expone datos de negocio, solo si las dependencias responden.
@Controller("health")
export class HealthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const report = await runHealthChecks("impulza-api", [
      {
        name: "database",
        check: async () => {
          await this.prisma.$queryRaw`SELECT 1`;
        },
      },
      {
        name: "redis",
        check: async () => {
          await this.redis.ping();
        },
      },
    ]);

    response.status(report.status === "ok" ? 200 : 503);
    return report;
  }
}
