import { createHmac } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AbuseReportStatus, type PrismaClient } from "@impulza/database";
import { ABUSE_REPORT_OPEN_PER_SITE_MAX, type CreateAbuseReportDto } from "@impulza/validation";
import type { Request } from "express";
import type { Redis } from "ioredis";
import { SERVED_SITE } from "../../common/active-organization.js";
import { resolveVisitorContext } from "../../common/visitor-context.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { REDIS } from "../../redis/redis.module.js";

/** Un mismo visitante no vuelve a reportar el mismo sitio dentro de esta ventana: la segunda vez se confirma sin guardar. */
export const ABUSE_REPORT_DEDUPE_SECONDS = 24 * 60 * 60;

/**
 * Reporte público de abuso (F9.9a). Tres defensas contra usar el mecanismo como arma, además del límite de tasa por IP del
 * controlador: (1) un visitante no reporta dos veces el mismo sitio en 24 h; (2) un sitio con muchos reportes abiertos deja
 * de guardar más (su prioridad ya es la máxima); (3) NUNCA despublica nada por sí solo: solo una persona del equipo decide.
 *
 * Del denunciante no se guarda la IP: la clave de control de repetición es un HMAC que vive en Redis y vence.
 */
@Injectable()
export class AbuseReportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private visitorKey(ip: string, siteId: string): string {
    const digest = createHmac("sha256", env.INTERNAL_PROXY_SECRET).update(`abuse-report:${ip}`).digest("hex");
    return `abuse-report:seen:${siteId}:${digest}`;
  }

  async createFromVisitor(siteSlug: string, dto: CreateAbuseReportDto, request: Request): Promise<void> {
    const site = await this.prisma.site.findFirst({
      where: { slug: siteSlug, ...SERVED_SITE },
      select: { id: true, organizationId: true },
    });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }

    const key = this.visitorKey(resolveVisitorContext(request).ip, site.id);
    const first = await this.redis.set(key, "1", "EX", ABUSE_REPORT_DEDUPE_SECONDS, "NX");
    if (first === null) {
      return; // ya reportó este sitio hoy: misma respuesta, nada nuevo en la base.
    }

    try {
      const open = await this.prisma.abuseReport.count({
        where: { siteId: site.id, status: { in: [AbuseReportStatus.OPEN, AbuseReportStatus.APPEALED] } },
      });
      if (open >= ABUSE_REPORT_OPEN_PER_SITE_MAX) {
        logger.warn("reporte de abuso descartado por tope de abiertos del sitio", { siteId: site.id, open });
        return;
      }

      const report = await this.prisma.abuseReport.create({
        data: {
          organizationId: site.organizationId,
          siteId: site.id,
          reason: dto.reason,
          details: dto.details && dto.details.length > 0 ? dto.details : null,
          reporterEmail: dto.email ?? null,
        },
        select: { id: true },
      });
      logger.info("reporte de abuso recibido", { reportId: report.id, siteId: site.id, reason: dto.reason });
    } catch (error) {
      // Si no quedó guardado, el visitante tiene que poder reintentar: se libera la marca de repetición.
      await this.redis.del(key);
      throw error;
    }
  }
}
