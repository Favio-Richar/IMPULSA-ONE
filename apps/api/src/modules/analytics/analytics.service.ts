import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  type AnalyticsEventJob,
  type AnalyticsEventType,
  type UtmParams,
  detectDeviceType,
  isBotUserAgent,
} from "@impulza/analytics";
import type { Queue } from "bullmq";
import type { Request } from "express";
import { resolveVisitorContext, type VisitorContext } from "../../common/visitor-context.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { ANALYTICS_QUEUE } from "./analytics.tokens.js";

export type RecordEventResult = "queued" | "ignored_bot" | "failed";

/**
 * Entrada del pipeline de analítica (F3.6, ST §10): endpoint → rate limit → **esta cola** → worker
 * (`apps/worker`) → `AnalyticsEvent` + `AnalyticsAggregate`. Acá se decide qué entra y en qué
 * forma: se descartan los bots y se minimiza todo antes de que el evento toque Redis (ADR-004
 * puntos 1 y 2). La IP y el user-agent crudos nunca salen de esta clase.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(ANALYTICS_QUEUE) private readonly queue: Queue<AnalyticsEventJob>) {}

  /** Para quien tiene que decidir algo más que registrar el evento (p. ej. no sumar el contador
   *  de un enlace corto cuando la visita es la vista previa automática de un chat). */
  isBot(request: Request): boolean {
    return isBotUserAgent(resolveVisitorContext(request).userAgent);
  }

  /**
   * Visitante anonimizado: hash con sal rotada por sitio (u organización, si el evento no es de
   * un sitio en particular: enlaces cortos y QR, F3.5) y por día. Nunca la IP cruda, nunca un
   * identificador estable entre días.
   */
  private anonymizedVisitorId(rotationKey: string, visitor: VisitorContext, day: string): string {
    return createHash("sha256")
      .update(`${env.ANALYTICS_SALT_SECRET}:${day}:${rotationKey}:${visitor.ip}:${visitor.userAgent ?? "unknown"}`)
      .digest("hex");
  }

  /**
   * Nunca lanza: la analítica es best-effort. Si Redis no está disponible, el visitante igual
   * llega a su destino y el formulario igual se guarda; queda el error en el log.
   */
  async recordEvent(params: {
    organizationId: string;
    siteId: string | null;
    type: AnalyticsEventType;
    request: Request;
    subjectId?: string | null;
    utm?: UtmParams | null;
    idempotencyKey?: string | null;
  }): Promise<RecordEventResult> {
    const visitor = resolveVisitorContext(params.request);
    if (isBotUserAgent(visitor.userAgent)) {
      return "ignored_bot";
    }

    const occurredAt = new Date();
    const job: AnalyticsEventJob = {
      organizationId: params.organizationId,
      siteId: params.siteId,
      type: params.type,
      anonymizedVisitorId: this.anonymizedVisitorId(
        params.siteId ?? params.organizationId,
        visitor,
        occurredAt.toISOString().slice(0, 10),
      ),
      device: detectDeviceType(visitor.userAgent),
      geoCountry: visitor.country,
      geoCity: visitor.city,
      utm: params.utm ?? null,
      subjectId: params.subjectId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      occurredAt: occurredAt.toISOString(),
    };

    try {
      await this.queue.add(params.type, job, {
        // Con clave de idempotencia, BullMQ tampoco encola dos veces el mismo evento mientras el
        // primero siga en la cola; la garantía definitiva es el índice único en la base.
        ...(job.idempotencyKey
          ? { jobId: `idem-${createHash("sha256").update(job.idempotencyKey).digest("hex")}` }
          : {}),
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 1000 },
        // Los fallidos definitivos quedan en la cola como "dead letter" inspeccionable (ST §16).
        removeOnFail: { count: 5000 },
      });
      return "queued";
    } catch (error) {
      logger.error("No se pudo encolar un evento de analítica", { type: params.type, err: error });
      return "failed";
    }
  }
}
