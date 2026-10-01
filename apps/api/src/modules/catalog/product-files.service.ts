import { ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { ProductFileUploadResponse, ProductResponse } from "@impulza/contracts";
import { type PrismaClient, type ProductFile, ProductFileStatus } from "@impulza/database";
import { MAGIC_BYTES_LENGTH, matchesDownloadType, productFileKey, type StorageAdapter } from "@impulza/storage";
import { isDownloadMimeType, type RequestProductFileUploadInput } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { PRIVATE_STORAGE } from "../../storage/storage.module.js";
import { AuditService } from "../audit/audit.service.js";
import { PlansService } from "../plans/plans.service.js";
import { CatalogSetupService, PRODUCT_NOT_FOUND } from "./catalog-setup.service.js";

const UPLOAD_URL_TTL_SECONDS = 10 * 60;

export const DOWNLOADS_NOT_CONFIGURED = "DOWNLOADS_NOT_CONFIGURED";
export const FILE_NOT_FOUND = "Archivo no encontrado.";
export const ONLY_DIGITAL = "Solo los productos digitales llevan un archivo para descargar.";

/**
 * Archivo en venta de un producto digital (F5.11b, ADR-015), en el bucket **privado**. Mismo flujo
 * que la biblioteca de medios (ADR-006): se reserva cuota y se entrega una URL prefirmada (tipo y
 * tamaño firmados); al confirmar se verifica en el bucket el tamaño exacto y el tipo real por bytes
 * mágicos. Un producto tiene a lo más un archivo listo: confirmar uno nuevo reemplaza al anterior.
 */
@Injectable()
export class ProductFilesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PRIVATE_STORAGE) private readonly storage: StorageAdapter | null,
    private readonly plans: PlansService,
    private readonly catalog: CatalogSetupService,
    private readonly audit: AuditService,
  ) {}

  private requireStorage(): StorageAdapter {
    if (!this.storage) {
      throw new HttpException(
        { statusCode: HttpStatus.SERVICE_UNAVAILABLE, code: DOWNLOADS_NOT_CONFIGURED, message: "La venta de archivos todavía no está habilitada en esta instalación." },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.storage;
  }

  private async productOrThrow(organizationId: string, siteId: string, productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, siteId, organizationId } });
    if (!product) throw new NotFoundException(PRODUCT_NOT_FOUND);
    return product;
  }

  async requestUpload(organizationId: string, actorId: string, siteId: string, productId: string, input: RequestProductFileUploadInput): Promise<ProductFileUploadResponse> {
    const storage = this.requireStorage();
    const product = await this.productOrThrow(organizationId, siteId, productId);
    if (product.kind !== "DIGITAL") throw new UnprocessableEntityException(ONLY_DIGITAL);

    // Cuenta para la cuota del plan, con el mismo candado por organización que los medios.
    const file = await this.prisma.$transaction(async (tx) => {
      await this.plans.assertStorageAvailable(tx, organizationId, input.sizeBytes);
      return tx.productFile.create({
        data: { organizationId, productId, fileName: input.fileName, contentType: input.contentType, sizeBytes: input.sizeBytes, uploadedById: actorId },
      });
    });
    const upload = await storage.createUploadUrl({
      key: productFileKey(organizationId, productId, file.id),
      contentType: input.contentType,
      contentLength: input.sizeBytes,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });
    return { fileId: file.id, upload: { url: upload.url, method: upload.method, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() } };
  }

  /** Falla la confirmación: se borra lo subido, el archivo queda `FAILED` (no ocupa cuota) y 422. */
  private async reject(storage: StorageAdapter, file: ProductFile, reason: string): Promise<never> {
    await storage.deleteObjects([productFileKey(file.organizationId, file.productId, file.id)]);
    await this.prisma.productFile.update({ where: { id: file.id }, data: { status: ProductFileStatus.FAILED } });
    logger.warn("archivo en venta rechazado al confirmar", { organizationId: file.organizationId, productId: file.productId, fileId: file.id, reason });
    throw new UnprocessableEntityException(reason);
  }

  async confirm(organizationId: string, actorId: string, siteId: string, productId: string, fileId: string): Promise<ProductResponse> {
    const storage = this.requireStorage();
    const product = await this.productOrThrow(organizationId, siteId, productId);
    const file = await this.prisma.productFile.findFirst({ where: { id: fileId, productId: product.id, organizationId } });
    if (!file) throw new NotFoundException(FILE_NOT_FOUND);
    // Confirmar dos veces (doble clic, reintento) no es un error.
    if (file.status === ProductFileStatus.READY) return this.catalog.toProductResponse(product, file, await this.catalog.variantsOf(product.id));
    if (file.status === ProductFileStatus.FAILED) throw new UnprocessableEntityException("Esta subida ya fue rechazada. Sube el archivo de nuevo.");

    const key = productFileKey(organizationId, product.id, file.id);
    const stored = await storage.head(key);
    if (!stored) throw new ConflictException("El archivo todavía no terminó de subirse.");
    if (stored.sizeBytes !== file.sizeBytes) return this.reject(storage, file, "El archivo subido no coincide con el tamaño declarado.");
    const start = await storage.readStart(key, MAGIC_BYTES_LENGTH);
    if (!isDownloadMimeType(file.contentType) || !matchesDownloadType(start, file.contentType)) {
      return this.reject(storage, file, "El archivo no es del formato indicado.");
    }

    // Reemplazo atómico: un candado por producto ordena dos confirmaciones simultáneas, y el índice
    // único parcial de la base garantiza que nunca queden dos archivos listos.
    const previous = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`product-file:${product.id}`}, 0))`;
      const old = await tx.productFile.findFirst({ where: { productId: product.id, status: ProductFileStatus.READY, id: { not: file.id } } });
      if (old) await tx.productFile.delete({ where: { id: old.id } });
      await tx.productFile.update({ where: { id: file.id }, data: { status: ProductFileStatus.READY, readyAt: new Date() } });
      return old;
    });
    if (previous) {
      await storage.deleteObjects([productFileKey(organizationId, product.id, previous.id)]).catch((error: unknown) => {
        logger.error("no se pudo borrar el archivo en venta reemplazado", { organizationId, productId: product.id, fileId: previous.id, error: error instanceof Error ? error.message : String(error) });
      });
    }
    await this.audit.record({
      organizationId,
      actorId,
      action: "catalog.product_file_uploaded",
      targetType: "Product",
      targetId: product.id,
      metadata: { fileId: file.id, contentType: file.contentType, sizeBytes: file.sizeBytes, replaced: previous !== null },
    });
    logger.info("archivo en venta listo", { organizationId, productId: product.id, fileId: file.id, sizeBytes: file.sizeBytes });
    return this.catalog.toProductResponse(product, await this.catalog.readyFileOf(product.id), await this.catalog.variantsOf(product.id));
  }

  /** Quita el archivo en venta: los compradores dejan de poder descargarlo. */
  async remove(organizationId: string, actorId: string, siteId: string, productId: string): Promise<ProductResponse> {
    const storage = this.requireStorage();
    const product = await this.productOrThrow(organizationId, siteId, productId);
    const file = await this.catalog.readyFileOf(product.id);
    if (!file) throw new NotFoundException(FILE_NOT_FOUND);
    // Primero el objeto: si el bucket falla, el archivo sigue listo y se puede reintentar.
    await storage.deleteObjects([productFileKey(organizationId, product.id, file.id)]);
    await this.prisma.productFile.delete({ where: { id: file.id } });
    await this.audit.record({ organizationId, actorId, action: "catalog.product_file_removed", targetType: "Product", targetId: product.id, metadata: { fileId: file.id } });
    return this.catalog.toProductResponse(product, null, await this.catalog.variantsOf(product.id));
  }
}
