import { ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { verifyOrderDownloadToken } from "@impulza/auth";
import type { PublicDownloadResponse, PublicDownloadUrlResponse } from "@impulza/contracts";
import { type PrismaClient, ProductFileStatus } from "@impulza/database";
import { productFileKey, type StorageAdapter } from "@impulza/storage";
import { MAX_DOWNLOADS_PER_ORDER } from "@impulza/validation";
import { ACTIVE_ORGANIZATION } from "../../common/active-organization.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { PRIVATE_STORAGE } from "../../storage/storage.module.js";
import { downloadState, type DownloadState } from "./download-access.js";

/** Vida de la URL firmada de lectura (ADR-015): alcanza para empezar la descarga, no para compartirla. */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
export const DOWNLOAD_NOT_FOUND = "El enlace de descarga no es válido.";

const STATE_MESSAGES: Record<Exclude<DownloadState, "ready">, string> = {
  awaiting_payment: "Tu pedido todavía no está pagado. Podrás descargar el archivo cuando el negocio confirme el pago.",
  revoked: "Este pedido fue cancelado o devuelto: el archivo ya no está disponible.",
  limit_reached: "Ya usaste todas las descargas de este pedido. Si necesitas bajarlo de nuevo, contacta al negocio.",
  unavailable: "Este producto ya no tiene un archivo para descargar. Contacta al negocio.",
};

/**
 * Descargas pagadas (F5.11b, ADR-015). Sin sesión: el enlace firmado del correo identifica el
 * pedido, y en **cada** uso se verifica en el servidor que esté pagado (`downloadState`). Ver no
 * cuenta; pedir la URL sí, con un incremento condicional (nunca más de `MAX_DOWNLOADS_PER_ORDER`,
 * aunque lleguen pedidos simultáneos). La URL es del bucket privado y vence en 5 minutos.
 */
@Injectable()
export class DownloadsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PRIVATE_STORAGE) private readonly storage: StorageAdapter | null,
  ) {}

  private async resolve(token: string) {
    const orderId = env.BOOKING_LINK_SECRET ? verifyOrderDownloadToken(token, env.BOOKING_LINK_SECRET) : null;
    if (!orderId) throw new NotFoundException(DOWNLOAD_NOT_FOUND);
    // Una organización suspendida no entrega archivos; un sitio archivado sí (el comprador ya pagó).
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, site: ACTIVE_ORGANIZATION },
      include: { site: { select: { slug: true, name: true } } },
    });
    if (!order) throw new NotFoundException(DOWNLOAD_NOT_FOUND);
    const file = order.productId ? await this.prisma.productFile.findFirst({ where: { productId: order.productId, status: ProductFileStatus.READY } }) : null;
    return { order, file, state: downloadState(order, file !== null && this.storage !== null) };
  }

  async view(token: string): Promise<PublicDownloadResponse> {
    const { order, file, state } = await this.resolve(token);
    return {
      siteSlug: order.site.slug,
      siteName: order.site.name,
      productName: order.productName,
      fileName: file?.fileName ?? null,
      sizeBytes: file?.sizeBytes ?? null,
      status: state,
      downloadsLeft: Math.max(0, MAX_DOWNLOADS_PER_ORDER - order.downloadCount),
    };
  }

  async issueUrl(token: string): Promise<PublicDownloadUrlResponse> {
    const { order, file, state } = await this.resolve(token);
    if (state !== "ready" || !file || !this.storage) {
      throw new ConflictException({ code: state === "ready" ? "unavailable" : state, message: STATE_MESSAGES[state === "ready" ? "unavailable" : state] });
    }
    // Condicional: el pedido sigue entregable y quedan descargas (dos clics a la vez nunca pasan el tope).
    const claimed = await this.prisma.order.updateMany({
      where: { id: order.id, status: { in: ["PAID", "DELIVERED"] }, downloadCount: { lt: MAX_DOWNLOADS_PER_ORDER } },
      data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException({ code: "limit_reached", message: STATE_MESSAGES.limit_reached });
    }
    let download;
    try {
      download = await this.storage.createDownloadUrl({
        key: productFileKey(order.organizationId, file.productId, file.id),
        expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
        fileName: file.fileName,
      });
    } catch (error) {
      // No se entregó nada: la descarga no cuenta.
      await this.prisma.order.update({ where: { id: order.id }, data: { downloadCount: { decrement: 1 } } });
      logger.error("no se pudo firmar la descarga", { organizationId: order.organizationId, orderId: order.id, error: error instanceof Error ? error.message : String(error) });
      throw new HttpException({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, message: "No pudimos preparar la descarga. Intenta de nuevo en un momento." }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    const used = order.downloadCount + 1;
    logger.info("descarga entregada", { organizationId: order.organizationId, orderId: order.id, downloadCount: used });
    return { url: download.url, expiresAt: download.expiresAt.toISOString(), downloadsLeft: Math.max(0, MAX_DOWNLOADS_PER_ORDER - used) };
  }
}
