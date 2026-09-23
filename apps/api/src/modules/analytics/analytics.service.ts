import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@impulza/database";
import type { Request } from "express";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";

/**
 * Núcleo de analítica (F3.4): por ahora solo lo que un clic público necesita — el pipeline
 * completo (cola BullMQ, worker, `AnalyticsAggregate`, purga por retención, exclusión de bots)
 * llega en F3.6. Esto ya aplica el no negociable de minimización desde el primer evento que se
 * escribe, no lo deja para cuando exista el pipeline completo (ADR-004 punto 1).
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Visitante anonimizado: hash con sal rotada por sitio (u organización, si el evento no es de
   * un sitio en particular — enlaces cortos y QR viven a nivel de organización, F3.5) y por día —
   * nunca la IP cruda, nunca un identificador estable entre días. La IP y el user-agent se leen de
   * la petición y se descartan de inmediato; no quedan en ninguna variable que sobreviva esta
   * función.
   */
  private anonymizedVisitorId(rotationKey: string, request: Request): string {
    const ip = request.ip ?? request.socket.remoteAddress ?? "unknown";
    const userAgent = request.get("user-agent") ?? "unknown";
    const day = new Date().toISOString().slice(0, 10);
    return createHash("sha256")
      .update(`${env.ANALYTICS_SALT_SECRET}:${day}:${rotationKey}:${ip}:${userAgent}`)
      .digest("hex");
  }

  async recordEvent(params: {
    organizationId: string;
    siteId: string | null;
    type: string;
    request: Request;
  }): Promise<void> {
    await this.prisma.analyticsEvent.create({
      data: {
        organizationId: params.organizationId,
        siteId: params.siteId,
        type: params.type,
        anonymizedVisitorId: this.anonymizedVisitorId(params.siteId ?? params.organizationId, params.request),
      },
    });
  }
}
