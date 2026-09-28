import { randomUUID } from "node:crypto";
import { HttpException, HttpStatus, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  AI_TASKS,
  AiUnavailableError,
  runWithFallback,
  type AiAttempt,
  type AiConnectionConfig,
  type AiProviderFactory,
  type AiRequest,
  type AiTask,
} from "@impulza/ai";
import { decryptSecret } from "@impulza/auth";
import type { AiConnection, PrismaClient } from "@impulza/database";
import type { Redis } from "ioredis";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { REDIS } from "../../redis/redis.module.js";
import { PlanLimitExceededException } from "../plans/plan-limit.exception.js";
import { PlansService } from "../plans/plans.service.js";

export const AI_PROVIDER_FACTORY = Symbol("AI_PROVIDER_FACTORY");

export const AI_UNAVAILABLE = "AI_UNAVAILABLE";

/** Solicitudes por usuario y minuto: frena un clic repetido o un script, no el uso normal. */
export const AI_USER_RATE_LIMIT = { limit: 20, windowSeconds: 60 } as const;

/** Mes calendario UTC de la cuota: `AAAA-MM`. */
function quotaPeriod(now: Date): { period: string; start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { period: start.toISOString().slice(0, 7), start, end };
}

/**
 * Puerta única del sistema hacia la IA (F6.2, ADR-010). Resuelve la ruta de la tarea desde la base,
 * aplica la cuota del plan y el límite por usuario, ejecuta con respaldo (`runWithFallback`) y
 * registra cada intento en `AiUsage` — sin prompt ni respuesta. Ningún otro módulo habla con un
 * proveedor de IA.
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(AI_PROVIDER_FACTORY) private readonly providerFactory: AiProviderFactory,
    private readonly plansService: PlansService,
  ) {}

  async status(organizationId: string) {
    const [routes, plan, used] = await Promise.all([
      this.prisma.aiRoute.findMany({ where: { connection: { enabled: true } }, select: { task: true } }),
      this.plansService.resolveEffectivePlan(organizationId),
      this.countSuccessfulRequests(organizationId, new Date()),
    ]);
    const routed = new Set(routes.map((route) => route.task));
    return {
      availableTasks: AI_TASKS.filter((task) => routed.has(task)),
      quota: { limit: plan.plan.limits.aiRequestsPerMonth, used, period: quotaPeriod(new Date()).period },
    };
  }

  /**
   * Ejecuta una tarea de IA para una organización y devuelve la salida ya validada con el esquema del
   * pedido. Errores: 503 `AI_UNAVAILABLE` (sin conexiones o ninguna respondió), 402 si se agotó la
   * cuota del mes, 429 si el usuario superó su límite por minuto.
   */
  async run<T>(input: { organizationId: string; userId: string; task: AiTask; request: AiRequest<T> }): Promise<T> {
    const { organizationId, userId, task } = input;
    const connections = await this.connectionsFor(task);
    if (connections.length === 0) {
      throw this.unavailable();
    }

    await this.enforceUserRate(userId);
    const quota = await this.reserveQuota(organizationId);

    const requestId = randomUUID();
    let attempts: AiAttempt[] = [];
    try {
      const result = await runWithFallback(connections.map((c) => c.config), input.request, this.providerFactory);
      attempts = result.attempts;
      return result.data;
    } catch (error) {
      await quota.release();
      if (error instanceof AiUnavailableError) {
        attempts = error.attempts;
        throw this.unavailable();
      }
      throw error;
    } finally {
      await this.recordUsage({ organizationId, userId, task, requestId, attempts, connections });
    }
  }

  // --- internos -----------------------------------------------------------------------------------

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: "Service Unavailable",
      code: AI_UNAVAILABLE,
      message: "El asistente de IA no está disponible en este momento.",
    });
  }

  private async connectionsFor(task: AiTask): Promise<Array<{ row: AiConnection; config: AiConnectionConfig }>> {
    const routes = await this.prisma.aiRoute.findMany({
      where: { task, connection: { enabled: true } },
      orderBy: { position: "asc" },
      include: { connection: true },
    });
    return routes.map(({ connection }) => ({ row: connection, config: this.toConfig(connection) }));
  }

  private toConfig(connection: AiConnection): AiConnectionConfig {
    return {
      id: connection.id,
      name: connection.name,
      kind: connection.kind,
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKeyEncrypted ? decryptSecret(connection.apiKeyEncrypted, env.AUTH_ENCRYPTION_KEY) : null,
      model: connection.model,
      jsonMode: connection.jsonMode,
      timeoutMs: connection.timeoutMs,
      inputMicroUsdPerMTok: connection.inputMicroUsdPerMTok,
      outputMicroUsdPerMTok: connection.outputMicroUsdPerMTok,
    };
  }

  private async enforceUserRate(userId: string): Promise<void> {
    const key = `ratelimit:ai-user:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, AI_USER_RATE_LIMIT.windowSeconds);
    }
    if (count > AI_USER_RATE_LIMIT.limit) {
      throw new HttpException("Demasiadas solicitudes al asistente. Espera un minuto.", HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Solicitudes con al menos un intento exitoso en el mes: la cuota cobra resultados, no fallas. */
  private async countSuccessfulRequests(organizationId: string, now: Date): Promise<number> {
    const { start, end } = quotaPeriod(now);
    const rows = await this.prisma.aiUsage.findMany({
      where: { organizationId, outcome: "ok", createdAt: { gte: start, lt: end } },
      distinct: ["requestId"],
      select: { requestId: true },
    });
    return rows.length;
  }

  /**
   * Reserva una solicitud de la cuota **antes** de llamar al proveedor, con un contador atómico en
   * Redis (semilla: el conteo real de la base). Así dos solicitudes simultáneas no pasan las dos con
   * el último cupo. Si la solicitud termina sin resultado, la reserva se devuelve.
   */
  private async reserveQuota(organizationId: string): Promise<{ release: () => Promise<void> }> {
    const now = new Date();
    const { plan } = await this.plansService.resolveEffectivePlan(organizationId);
    const limit = plan.limits.aiRequestsPerMonth;
    if (limit === null) {
      return { release: async () => {} };
    }

    const key = `ai:quota:${organizationId}:${quotaPeriod(now).period}`;
    if (!(await this.redis.exists(key))) {
      await this.redis.set(key, await this.countSuccessfulRequests(organizationId, now), "EX", 40 * 24 * 3600, "NX");
    }
    const used = await this.redis.incr(key);
    if (used > limit) {
      await this.redis.decr(key);
      throw new PlanLimitExceededException("aiRequestsPerMonth", limit, used - 1, { code: plan.code, name: plan.name });
    }
    return { release: async () => void (await this.redis.decr(key)) };
  }

  private async recordUsage(input: {
    organizationId: string;
    userId: string;
    task: AiTask;
    requestId: string;
    attempts: AiAttempt[];
    connections: Array<{ row: AiConnection }>;
  }): Promise<void> {
    const kinds = new Map(input.connections.map(({ row }) => [row.id, row.kind]));
    try {
      await this.prisma.aiUsage.createMany({
        data: input.attempts.map((attempt) => ({
          organizationId: input.organizationId,
          userId: input.userId,
          requestId: input.requestId,
          task: input.task,
          connectionId: attempt.connectionId,
          providerKind: kinds.get(attempt.connectionId) ?? "OPENAI_COMPATIBLE",
          model: attempt.model,
          outcome: attempt.outcome,
          inputTokens: attempt.inputTokens,
          outputTokens: attempt.outputTokens,
          costMicroUsd: attempt.costMicroUsd,
          durationMs: attempt.durationMs,
        })),
      });
    } catch (error) {
      // Registrar nunca debe romper la respuesta al usuario; sí debe quedar a la vista.
      logger.error("no se pudo registrar el uso de IA", { requestId: input.requestId, error: error instanceof Error ? error.message : String(error) });
    }
    logger.info("solicitud de IA", {
      organizationId: input.organizationId,
      requestId: input.requestId,
      task: input.task,
      outcomes: input.attempts.map((attempt) => attempt.outcome),
      costMicroUsd: input.attempts.reduce((sum, attempt) => sum + attempt.costMicroUsd, 0),
    });
  }
}
