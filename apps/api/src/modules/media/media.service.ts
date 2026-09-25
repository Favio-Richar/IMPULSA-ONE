import { ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { MediaAssetResponse, MediaLibraryResponse, MediaUploadResponse } from "@impulza/contracts";
import { type MediaAsset, MediaKind, MediaStatus, type PrismaClient, type User } from "@impulza/database";
import {
  detectImageType,
  MAGIC_BYTES_LENGTH,
  type MediaProcessJob,
  originalKey,
  type StorageAdapter,
} from "@impulza/storage";
import { mediaVariantsSchema, type RequestImageUploadInput } from "@impulza/validation";
import type { Queue } from "bullmq";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { STORAGE } from "../../storage/storage.module.js";
import { AuditService } from "../audit/audit.service.js";
import { PlansService } from "../plans/plans.service.js";
import { MEDIA_QUEUE } from "./media.tokens.js";

const ASSET_NOT_FOUND = "Archivo no encontrado.";
const UPLOAD_URL_TTL_SECONDS = 10 * 60;
const BYTES_PER_MB = 1024 * 1024;

export const STORAGE_NOT_CONFIGURED = "STORAGE_NOT_CONFIGURED";
export const MEDIA_IN_USE = "MEDIA_IN_USE";

/**
 * Biblioteca de medios (PP1, ADR-006). Todo acotado a la organización (ADR-002): un asset de otra
 * organización responde 404 como si no existiera.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(STORAGE) private readonly storage: StorageAdapter | null,
    @Inject(MEDIA_QUEUE) private readonly queue: Queue<MediaProcessJob>,
    @Inject(PlansService) private readonly plansService: PlansService,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private requireStorage(): StorageAdapter {
    if (!this.storage) {
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          code: STORAGE_NOT_CONFIGURED,
          message: "La subida de archivos todavía no está habilitada en esta instalación.",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.storage;
  }

  toResponse(asset: MediaAsset): MediaAssetResponse {
    const variants = mediaVariantsSchema.safeParse(asset.variants);
    const ready = asset.status === MediaStatus.READY && variants.success && variants.data.length > 0 && this.storage;
    const publicVariants = ready
      ? [...variants.data].sort((a, b) => a.width - b.width).map((variant) => ({ width: variant.width, url: this.storage!.publicUrl(variant.key) }))
      : [];
    return {
      id: asset.id,
      kind: asset.kind,
      status: asset.status,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.status === MediaStatus.READY ? asset.storedBytes : asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      url: publicVariants.at(-1)?.url ?? null,
      variants: publicVariants,
      failureReason: asset.failureReason,
      createdAt: asset.createdAt.toISOString(),
    };
  }

  async library(organizationId: string): Promise<MediaLibraryResponse> {
    const [assets, usedBytes, effective] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        // Las subidas pedidas y nunca confirmadas no se muestran: son reservas, no archivos.
        where: { organizationId, status: { not: MediaStatus.PENDING_UPLOAD } },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.plansService.storageBytesUsed(organizationId),
      this.plansService.resolveEffectivePlan(organizationId),
    ]);
    const limitMb = effective.plan.limits.storageMb;
    return {
      items: assets.map((asset) => this.toResponse(asset)),
      usage: { usedBytes, limitBytes: limitMb === null ? null : limitMb * BYTES_PER_MB },
      storageConfigured: this.storage !== null,
    };
  }

  private async getOrThrow(organizationId: string, assetId: string): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) {
      throw new NotFoundException(ASSET_NOT_FOUND);
    }
    return asset;
  }

  async get(organizationId: string, assetId: string): Promise<MediaAssetResponse> {
    return this.toResponse(await this.getOrThrow(organizationId, assetId));
  }

  /** Reserva cuota y emite la URL prefirmada. La clave la decide el servidor (ADR-006 §2). */
  async requestUpload(organizationId: string, user: User, input: RequestImageUploadInput): Promise<MediaUploadResponse> {
    const storage = this.requireStorage();

    const asset = await this.prisma.$transaction(async (tx) => {
      await this.plansService.assertStorageAvailable(tx, organizationId, input.sizeBytes);
      return tx.mediaAsset.create({
        data: {
          organizationId,
          uploadedById: user.id,
          kind: MediaKind.IMAGE,
          fileName: input.fileName,
          mimeType: input.contentType,
          sizeBytes: input.sizeBytes,
        },
      });
    });

    const upload = await storage.createUploadUrl({
      key: originalKey(organizationId, asset.id),
      contentType: input.contentType,
      contentLength: input.sizeBytes,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    return {
      asset: this.toResponse(asset),
      upload: { url: upload.url, method: upload.method, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() },
    };
  }

  /** Falla la confirmación: borra lo subido, deja el asset `FAILED` (no ocupa cuota) y responde 422. */
  private async reject(storage: StorageAdapter, asset: MediaAsset, reason: string): Promise<never> {
    await storage.deleteObjects([originalKey(asset.organizationId, asset.id)]);
    await this.prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: MediaStatus.FAILED, failureReason: reason } });
    logger.warn("subida de medio rechazada al confirmar", { organizationId: asset.organizationId, assetId: asset.id, reason });
    throw new UnprocessableEntityException(reason);
  }

  /**
   * Verifica lo que de verdad quedó en el bucket (ADR-006 §3): el tamaño exacto declarado y el tipo
   * real por bytes mágicos. Recién ahí encola el procesamiento.
   */
  async confirm(organizationId: string, assetId: string): Promise<MediaAssetResponse> {
    const storage = this.requireStorage();
    const asset = await this.getOrThrow(organizationId, assetId);
    if (asset.status !== MediaStatus.PENDING_UPLOAD) {
      // Confirmar dos veces (doble clic, reintento de red) no es un error: devuelve el estado actual.
      return this.toResponse(asset);
    }

    const key = originalKey(organizationId, asset.id);
    const stored = await storage.head(key);
    if (!stored) {
      throw new ConflictException("El archivo todavía no terminó de subirse.");
    }
    if (stored.sizeBytes !== asset.sizeBytes) {
      return this.reject(storage, asset, "El archivo subido no coincide con el tamaño declarado.");
    }
    const detected = detectImageType(await storage.readStart(key, MAGIC_BYTES_LENGTH));
    if (!detected || detected !== asset.mimeType) {
      return this.reject(storage, asset, "El archivo no es una imagen válida del formato indicado.");
    }

    const processing = await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: MediaStatus.PROCESSING, mimeType: detected },
    });
    // `jobId` = id del asset: confirmar dos veces nunca encola dos procesamientos.
    await this.queue.add("process", { assetId: asset.id }, { jobId: asset.id, attempts: 3, backoff: { type: "exponential", delay: 2000 } });
    logger.info("medio confirmado y en cola de procesamiento", { organizationId, assetId: asset.id, sizeBytes: asset.sizeBytes });
    return this.toResponse(processing);
  }

  /**
   * Páginas que usan el asset: en un bloque vigente (último borrador) o en la versión publicada
   * vigente. Borrarlo rompería una imagen que alguien está viendo (ADR-006 §8).
   */
  async usages(organizationId: string, assetId: string): Promise<Array<{ pageId: string; pageSlug: string; siteName: string }>> {
    const pattern = `%${assetId}%`;
    return this.prisma.$queryRaw<Array<{ pageId: string; pageSlug: string; siteName: string }>>`
      SELECT p.id AS "pageId", p.slug AS "pageSlug", s.name AS "siteName"
      FROM pages p
      JOIN sites s ON s.id = p.site_id
      WHERE s.organization_id = ${organizationId}::uuid
        AND (
          EXISTS (
            SELECT 1 FROM blocks b
            JOIN LATERAL (
              SELECT bv.config FROM block_versions bv WHERE bv.block_id = b.id ORDER BY bv.version_number DESC LIMIT 1
            ) current_version ON true
            WHERE b.page_id = p.id AND current_version.config::text LIKE ${pattern}
          )
          OR EXISTS (
            SELECT 1 FROM page_versions pv
            WHERE pv.page_id = p.id
              AND pv.version_number = (SELECT max(version_number) FROM page_versions WHERE page_id = p.id)
              AND pv.content_snapshot::text LIKE ${pattern}
          )
        )
      ORDER BY s.name, p.slug`;
  }

  async remove(organizationId: string, user: User, assetId: string): Promise<void> {
    const asset = await this.getOrThrow(organizationId, assetId);
    const usages = await this.usages(organizationId, asset.id);
    if (usages.length > 0) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        code: MEDIA_IN_USE,
        message: "Esta imagen se está usando. Quítala de esas páginas antes de borrarla.",
        usages,
      });
    }

    const variants = mediaVariantsSchema.safeParse(asset.variants);
    const keys = [originalKey(organizationId, asset.id), ...(variants.success ? variants.data.map((variant) => variant.key) : [])];
    if (this.storage) {
      await this.storage.deleteObjects(keys);
    }
    await this.prisma.mediaAsset.delete({ where: { id: asset.id } });
    await this.auditService.record({
      organizationId,
      actorId: user.id,
      action: "media.deleted",
      targetType: "MediaAsset",
      targetId: asset.id,
      metadata: { fileName: asset.fileName },
    });
  }
}
