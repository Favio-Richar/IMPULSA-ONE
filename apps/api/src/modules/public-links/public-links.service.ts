import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@impulza/database";
import type { Request } from "express";
import { PRISMA } from "../../database/prisma.module.js";
import { AnalyticsService } from "../analytics/analytics.service.js";

@Injectable()
export class PublicLinksService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly analyticsService: AnalyticsService,
  ) {}

  /** Enlace corto (F3.5): resuelve el destino, cuenta el clic y registra el evento — todo antes
   *  de que quien llama (la ruta de `apps/web`) emita el redirect real al visitante. */
  async resolveShortLink(slug: string, request: Request): Promise<{ destinationUrl: string }> {
    const link = await this.prisma.shortLink.findUnique({ where: { slug } });
    if (!link) {
      throw new NotFoundException("Enlace no encontrado.");
    }

    // Un bot igual recibe el redirect (no hay por qué romperle la vista previa del enlace a quien
    // lo pegó en un chat), pero no cuenta: esa visita automática no la hizo ninguna persona
    // (ADR-004 punto 2, F3.6).
    if (!this.analyticsService.isBot(request)) {
      await this.prisma.shortLink.update({
        where: { id: link.id },
        data: { clickCountCached: { increment: 1 } },
      });

      await this.analyticsService.recordEvent({
        organizationId: link.organizationId,
        siteId: null,
        type: "short_link_click",
        request,
        subjectId: link.id,
      });
    }

    return { destinationUrl: link.destinationUrl };
  }

  /** Código QR (F3.5): mismo patrón que arriba, pero con su propio contador (`scanCountCached`)
   *  y su propio tipo de evento (`qr_visit`) — un escaneo no es lo mismo que un clic al enlace
   *  corto, aunque terminen en el mismo destino. */
  async resolveQrCode(qrCodeId: string, request: Request): Promise<{ destinationUrl: string }> {
    const qrCode = await this.prisma.qrCode.findUnique({
      where: { id: qrCodeId },
      include: { shortLink: { select: { destinationUrl: true } } },
    });

    const destinationUrl = qrCode?.shortLink?.destinationUrl ?? qrCode?.directUrl ?? null;
    if (!qrCode || !destinationUrl) {
      throw new NotFoundException("Código QR no encontrado.");
    }

    if (!this.analyticsService.isBot(request)) {
      await this.prisma.qrCode.update({
        where: { id: qrCode.id },
        data: { scanCountCached: { increment: 1 } },
      });

      await this.analyticsService.recordEvent({
        organizationId: qrCode.organizationId,
        siteId: null,
        type: "qr_visit",
        request,
        subjectId: qrCode.id,
      });
    }

    return { destinationUrl };
  }
}
