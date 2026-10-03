import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { PrismaClient, BrandProfile } from "@impulza/database";
import type {
  BrandProfileResponse,
  ResolvedBrandResponse,
  UploadBrandProfileAssetResponse,
} from "@impulza/contracts";
import {
  MAX_BRANDING_DIMENSION,
  MAX_BRANDING_FAVICON_BYTES,
  MAX_BRANDING_LOGO_BYTES,
  MIN_BRANDING_FAVICON_DIMENSION,
  MIN_BRANDING_LOGO_DIMENSION,
  validateAndSanitizeSvg,
  type UpdateBrandProfileDto,
  type UploadBrandingAssetDto,
} from "@impulza/validation";
import { detectImageType, MAGIC_BYTES_LENGTH, type StorageAdapter } from "@impulza/storage";
import sharp from "sharp";
import { PRISMA } from "../../database/prisma.module.js";
import { STORAGE } from "../../storage/storage.module.js";
import { AuditService } from "../audit/audit.service.js";
import { PlatformBrandingService } from "../platform-branding/platform-branding.service.js";
import { logger } from "../../observability/logger.js";

@Injectable()
export class BrandProfileService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(STORAGE) private readonly storage: StorageAdapter | null,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(PlatformBrandingService) private readonly platformBrandingService: PlatformBrandingService,
  ) {}

  private toResponse(profile: BrandProfile): BrandProfileResponse {
    return {
      id: profile.id,
      organizationId: profile.organizationId,
      displayName: profile.displayName,
      logoLightUrl: profile.logoLightUrl,
      logoDarkUrl: profile.logoDarkUrl,
      faviconUrl: profile.faviconUrl,
      primaryColor: profile.primaryColor,
      secondaryColor: profile.secondaryColor,
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
      legalName: profile.legalName,
      taxId: profile.taxId,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  /**
   * Cascada de marca ADR-028 §4 — el ÚNICO lugar que decide qué marca se aplica.
   * Orden: marca blanca de agencia (F9.7, aún no implementado) → marca de la organización →
   * marca de la plataforma. Siempre devuelve un objeto con valores válidos.
   */
  async resolveBrand(organizationId: string): Promise<ResolvedBrandResponse> {
    // Paso 1: perfil de la organización
    const profile = await this.prisma.brandProfile.findUnique({
      where: { organizationId },
    });

    // Paso 2: fallback a la marca de plataforma
    const platform = await this.platformBrandingService.getPublic();

    return {
      displayName: profile?.displayName ?? platform.name,
      logoLightUrl: profile?.logoLightUrl ?? platform.logoLightUrl ?? null,
      logoDarkUrl: profile?.logoDarkUrl ?? platform.logoDarkUrl ?? null,
      faviconUrl: profile?.faviconUrl ?? platform.faviconUrl ?? null,
      primaryColor: profile?.primaryColor ?? platform.primaryColor,
      secondaryColor: profile?.secondaryColor ?? platform.secondaryColor,
      contactEmail: profile?.contactEmail ?? null,
      senderName: platform.name,
      senderEmail: null, // F9.7 (marca blanca) lo completará con remitente verificado
    };
  }

  async getByOrg(organizationId: string): Promise<BrandProfileResponse> {
    let profile = await this.prisma.brandProfile.findUnique({
      where: { organizationId },
    });

    if (!profile) {
      // Crear fila vacía para esta organización si no existe (migración puede haberla omitido)
      profile = await this.prisma.brandProfile.create({
        data: { organizationId },
      });
    }

    return this.toResponse(profile);
  }

  async update(
    actorId: string,
    organizationId: string,
    input: UpdateBrandProfileDto,
  ): Promise<BrandProfileResponse> {
    const previous = await this.prisma.brandProfile.findUnique({ where: { organizationId } });

    const updated = await this.prisma.brandProfile.upsert({
      where: { organizationId },
      update: {
        displayName: input.displayName ?? null,
        logoLightUrl: input.logoLightUrl ?? null,
        logoDarkUrl: input.logoDarkUrl ?? null,
        faviconUrl: input.faviconUrl ?? null,
        primaryColor: input.primaryColor ?? null,
        secondaryColor: input.secondaryColor ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        legalName: input.legalName ?? null,
        taxId: input.taxId ?? null,
        updatedAt: new Date(),
      },
      create: {
        organizationId,
        displayName: input.displayName ?? null,
        logoLightUrl: input.logoLightUrl ?? null,
        logoDarkUrl: input.logoDarkUrl ?? null,
        faviconUrl: input.faviconUrl ?? null,
        primaryColor: input.primaryColor ?? null,
        secondaryColor: input.secondaryColor ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        legalName: input.legalName ?? null,
        taxId: input.taxId ?? null,
      },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "org.brand_profile_updated",
      targetType: "BrandProfile",
      targetId: updated.id,
      metadata: {
        fieldsUpdated: Object.keys(input).filter((k) => input[k as keyof UpdateBrandProfileDto] != null),
        previousValues: previous
          ? {
              displayName: previous.displayName,
              primaryColor: previous.primaryColor,
              secondaryColor: previous.secondaryColor,
            }
          : null,
      },
    });

    logger.info("brand-profile: perfil de marca de organización actualizado", {
      organizationId,
      actorId,
    });

    return this.toResponse(updated);
  }

  async uploadAsset(
    actorId: string,
    organizationId: string,
    input: UploadBrandingAssetDto,
  ): Promise<UploadBrandProfileAssetResponse> {
    const maxBytes = input.target === "favicon" ? MAX_BRANDING_FAVICON_BYTES : MAX_BRANDING_LOGO_BYTES;
    if (input.sizeBytes > maxBytes) {
      throw new BadRequestException(
        `El archivo excede el tamaño máximo permitido de ${Math.round(maxBytes / 1024)} KB.`,
      );
    }

    let base64 = input.base64Data;
    const dataUrlMatch = base64.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUrlMatch) {
      base64 = dataUrlMatch[2]!;
    }
    const buffer = Buffer.from(base64, "base64");

    if (buffer.length > maxBytes) {
      throw new BadRequestException(
        `El contenido decodificado excede el tamaño máximo de ${Math.round(maxBytes / 1024)} KB.`,
      );
    }

    let bodyBuffer: Buffer;
    let extension = "png";

    if (input.contentType === "image/svg+xml") {
      const svgText = buffer.toString("utf8");
      const validation = validateAndSanitizeSvg(svgText);
      if (!validation.ok) {
        throw new BadRequestException(validation.error);
      }
      bodyBuffer = Buffer.from(validation.sanitized, "utf8");
      extension = "svg";
    } else {
      const magicBytes = new Uint8Array(buffer.subarray(0, MAGIC_BYTES_LENGTH));
      const detected = detectImageType(magicBytes);
      if (!detected || detected !== input.contentType) {
        throw new BadRequestException("El contenido del archivo no coincide con el formato de imagen declarado.");
      }
      let width: number | undefined;
      let height: number | undefined;
      try {
        const metadata = await sharp(buffer, { limitInputPixels: MAX_BRANDING_DIMENSION * MAX_BRANDING_DIMENSION }).metadata();
        width = metadata.width;
        height = metadata.height;
      } catch {
        throw new BadRequestException("No se pudo leer la imagen: el archivo está dañado o no es válido.");
      }
      const minimum = input.target === "favicon" ? MIN_BRANDING_FAVICON_DIMENSION : MIN_BRANDING_LOGO_DIMENSION;
      if (!width || !height || width < minimum || height < minimum) {
        throw new BadRequestException(`La imagen es demasiado pequeña: debe medir al menos ${minimum} × ${minimum} px.`);
      }
      if (width > MAX_BRANDING_DIMENSION || height > MAX_BRANDING_DIMENSION) {
        throw new BadRequestException(`La imagen es demasiado grande: el máximo es ${MAX_BRANDING_DIMENSION} × ${MAX_BRANDING_DIMENSION} px.`);
      }
      bodyBuffer = buffer;
      if (input.contentType === "image/jpeg") extension = "jpg";
      else if (input.contentType === "image/webp") extension = "webp";
      else extension = "png";
    }

    if (this.storage) {
      const key = `branding/org/${organizationId}/${input.target}-${Date.now()}.${extension}`;
      await this.storage.putObject({
        key,
        body: new Uint8Array(bodyBuffer),
        contentType: input.contentType,
        cacheControl: "public, max-age=31536000, immutable",
      });
      return { url: this.storage.publicUrl(key) };
    }

    throw new ServiceUnavailableException(
      "El almacenamiento de archivos no está configurado. Configúralo para subir logotipos.",
    );
  }
}
