import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Redis } from "ioredis";
import type { PrismaClient, PlatformBranding } from "@impulza/database";
import type {
  PublicPlatformBrandingResponse,
  PlatformBrandingResponse,
  UploadBrandingAssetResponse,
} from "@impulza/contracts";
import {
  DEFAULT_PLATFORM_BRANDING,
  type UpdatePlatformBrandingDto,
  type UploadBrandingAssetDto,
} from "@impulza/validation";
import type { StorageAdapter } from "@impulza/storage";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { STORAGE } from "../../storage/storage.module.js";
import { AuditService } from "../audit/audit.service.js";
import { prepareBrandingAsset } from "./branding-asset.js";
import { logger } from "../../observability/logger.js";
import {
  PLATFORM_BRANDING_CACHE_KEY,
  PLATFORM_BRANDING_CACHE_TTL_SECONDS,
  PLATFORM_BRANDING_SINGLETON_ID,
} from "./platform-branding.tokens.js";

@Injectable()
export class PlatformBrandingService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(STORAGE) private readonly storage: StorageAdapter | null,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  private toPublicResponse(branding: {
    name: string;
    logoLightUrl: string | null;
    logoDarkUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
    supportUrl: string | null;
    privacyUrl: string | null;
    termsUrl: string | null;
    footerText: string | null;
  }): PublicPlatformBrandingResponse {
    return {
      name: branding.name,
      logoLightUrl: branding.logoLightUrl,
      logoDarkUrl: branding.logoDarkUrl,
      faviconUrl: branding.faviconUrl,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      supportUrl: branding.supportUrl,
      privacyUrl: branding.privacyUrl,
      termsUrl: branding.termsUrl,
      footerText: branding.footerText,
    };
  }

  private toAdminResponse(branding: PlatformBranding): PlatformBrandingResponse {
    return {
      id: branding.id,
      name: branding.name,
      logoLightUrl: branding.logoLightUrl,
      logoDarkUrl: branding.logoDarkUrl,
      faviconUrl: branding.faviconUrl,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      senderName: branding.senderName,
      senderEmail: branding.senderEmail,
      supportUrl: branding.supportUrl,
      privacyUrl: branding.privacyUrl,
      termsUrl: branding.termsUrl,
      footerText: branding.footerText,
      updatedByAdminId: branding.updatedByAdminId,
      createdAt: branding.createdAt.toISOString(),
      updatedAt: branding.updatedAt.toISOString(),
    };
  }

  /**
   * Obtiene la marca pública de la plataforma. Con caché corta en Redis e invalidación al guardar.
   * Si la base está vacía o falla la infraestructura, cae limpiamente a la marca por defecto.
   * Nunca expone correos internos ni datos sensibles.
   */
  async getPublic(): Promise<PublicPlatformBrandingResponse> {
    try {
      const cached = await this.redis.get(PLATFORM_BRANDING_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached) as PublicPlatformBrandingResponse;
      }
    } catch (error) {
      logger.warn("platform-branding: no se pudo leer de Redis, se consulta la base de datos", { error });
    }

    let publicData: PublicPlatformBrandingResponse;
    try {
      const row = await this.prisma.platformBranding.findFirst({
        orderBy: { createdAt: "asc" },
      });
      if (row) {
        publicData = this.toPublicResponse(row);
      } else {
        publicData = this.toPublicResponse(DEFAULT_PLATFORM_BRANDING);
      }
    } catch (error) {
      logger.error("platform-branding: error al consultar la base de datos, usando valores por defecto", { error });
      publicData = this.toPublicResponse(DEFAULT_PLATFORM_BRANDING);
    }

    try {
      await this.redis.setex(
        PLATFORM_BRANDING_CACHE_KEY,
        PLATFORM_BRANDING_CACHE_TTL_SECONDS,
        JSON.stringify(publicData),
      );
    } catch (error) {
      logger.warn("platform-branding: no se pudo escribir en la caché de Redis", { error });
    }

    return publicData;
  }

  /**
   * Obtiene la marca completa para superadministración (incluye remitente y metadatos de auditoría).
   */
  async getAdmin(): Promise<PlatformBrandingResponse> {
    const row = await this.prisma.platformBranding.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (row) {
      return this.toAdminResponse(row);
    }

    return {
      id: PLATFORM_BRANDING_SINGLETON_ID,
      ...DEFAULT_PLATFORM_BRANDING,
      updatedByAdminId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Actualiza la configuración de marca de la plataforma (solo superadministrador).
   * Registra auditoría con valores anteriores sin datos sensibles e invalida la caché pública.
   */
  async update(adminId: string, input: UpdatePlatformBrandingDto): Promise<PlatformBrandingResponse> {
    const previous = (await this.prisma.platformBranding.findFirst({
      orderBy: { createdAt: "asc" },
    })) ?? DEFAULT_PLATFORM_BRANDING;

    const updated = await this.prisma.platformBranding.upsert({
      where: { id: PLATFORM_BRANDING_SINGLETON_ID },
      update: {
        name: input.name,
        logoLightUrl: input.logoLightUrl ?? null,
        logoDarkUrl: input.logoDarkUrl ?? null,
        faviconUrl: input.faviconUrl ?? null,
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        senderName: input.senderName,
        senderEmail: input.senderEmail ?? null,
        supportUrl: input.supportUrl ?? null,
        privacyUrl: input.privacyUrl ?? null,
        termsUrl: input.termsUrl ?? null,
        footerText: input.footerText ?? null,
        updatedByAdminId: adminId,
        updatedAt: new Date(),
      },
      create: {
        id: PLATFORM_BRANDING_SINGLETON_ID,
        name: input.name,
        logoLightUrl: input.logoLightUrl ?? null,
        logoDarkUrl: input.logoDarkUrl ?? null,
        faviconUrl: input.faviconUrl ?? null,
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        senderName: input.senderName,
        senderEmail: input.senderEmail ?? null,
        supportUrl: input.supportUrl ?? null,
        privacyUrl: input.privacyUrl ?? null,
        termsUrl: input.termsUrl ?? null,
        footerText: input.footerText ?? null,
        updatedByAdminId: adminId,
      },
    });

    // Invalida caché pública de inmediato
    try {
      await this.redis.del(PLATFORM_BRANDING_CACHE_KEY);
    } catch (error) {
      logger.warn("platform-branding: error al invalidar caché en Redis tras actualizar", { error });
    }

    // Registro de auditoría
    await this.auditService.record({
      organizationId: null,
      actorId: adminId,
      action: "admin.platform_branding_updated",
      targetType: "PlatformBranding",
      targetId: PLATFORM_BRANDING_SINGLETON_ID,
      metadata: {
        fieldsUpdated: Object.keys(input),
        previousValues: {
          name: previous.name,
          primaryColor: previous.primaryColor,
          secondaryColor: previous.secondaryColor,
          senderName: previous.senderName,
        },
      },
    });

    logger.info("platform-branding: marca de plataforma actualizada", {
      adminId,
      name: updated.name,
      primaryColor: updated.primaryColor,
    });

    return this.toAdminResponse(updated);
  }

  /**
   * Restablece la configuración de marca a los valores por defecto oficiales de Impulza One.
   */
  async reset(adminId: string): Promise<PlatformBrandingResponse> {
    const updated = await this.prisma.platformBranding.upsert({
      where: { id: PLATFORM_BRANDING_SINGLETON_ID },
      update: {
        name: DEFAULT_PLATFORM_BRANDING.name,
        logoLightUrl: DEFAULT_PLATFORM_BRANDING.logoLightUrl,
        logoDarkUrl: DEFAULT_PLATFORM_BRANDING.logoDarkUrl,
        faviconUrl: DEFAULT_PLATFORM_BRANDING.faviconUrl,
        primaryColor: DEFAULT_PLATFORM_BRANDING.primaryColor,
        secondaryColor: DEFAULT_PLATFORM_BRANDING.secondaryColor,
        senderName: DEFAULT_PLATFORM_BRANDING.senderName,
        senderEmail: DEFAULT_PLATFORM_BRANDING.senderEmail,
        supportUrl: DEFAULT_PLATFORM_BRANDING.supportUrl,
        privacyUrl: DEFAULT_PLATFORM_BRANDING.privacyUrl,
        termsUrl: DEFAULT_PLATFORM_BRANDING.termsUrl,
        footerText: DEFAULT_PLATFORM_BRANDING.footerText,
        updatedByAdminId: adminId,
        updatedAt: new Date(),
      },
      create: {
        id: PLATFORM_BRANDING_SINGLETON_ID,
        name: DEFAULT_PLATFORM_BRANDING.name,
        logoLightUrl: DEFAULT_PLATFORM_BRANDING.logoLightUrl,
        logoDarkUrl: DEFAULT_PLATFORM_BRANDING.logoDarkUrl,
        faviconUrl: DEFAULT_PLATFORM_BRANDING.faviconUrl,
        primaryColor: DEFAULT_PLATFORM_BRANDING.primaryColor,
        secondaryColor: DEFAULT_PLATFORM_BRANDING.secondaryColor,
        senderName: DEFAULT_PLATFORM_BRANDING.senderName,
        senderEmail: DEFAULT_PLATFORM_BRANDING.senderEmail,
        supportUrl: DEFAULT_PLATFORM_BRANDING.supportUrl,
        privacyUrl: DEFAULT_PLATFORM_BRANDING.privacyUrl,
        termsUrl: DEFAULT_PLATFORM_BRANDING.termsUrl,
        footerText: DEFAULT_PLATFORM_BRANDING.footerText,
        updatedByAdminId: adminId,
      },
    });

    // Invalida caché pública de inmediato
    try {
      await this.redis.del(PLATFORM_BRANDING_CACHE_KEY);
    } catch (error) {
      logger.warn("platform-branding: error al invalidar caché en Redis tras restablecer", { error });
    }

    // Registro de auditoría
    await this.auditService.record({
      organizationId: null,
      actorId: adminId,
      action: "admin.platform_branding_reset",
      targetType: "PlatformBranding",
      targetId: PLATFORM_BRANDING_SINGLETON_ID,
      metadata: { resetToDefault: true },
    });

    logger.info("platform-branding: marca de plataforma restablecida a valores por defecto", { adminId });

    return this.toAdminResponse(updated);
  }

  /**
   * Sube un archivo de logotipo o favicon para la marca de la plataforma (PNG, JPG, WebP o SVG saneado).
   * La validación vive en `prepareBrandingAsset`, compartida con la marca de cada organización.
   */
  async uploadAsset(_adminId: string, input: UploadBrandingAssetDto): Promise<UploadBrandingAssetResponse> {
    const prepared = await prepareBrandingAsset(input);

    if (!this.storage) {
      // Sin almacenamiento no hay URL pública que guardar: un `data:` URI no pasaría la validación de la
      // marca (solo `https://`), así que se avisa con claridad en vez de devolver algo inservible.
      throw new ServiceUnavailableException("El almacenamiento de archivos no está configurado. Configúralo para subir logotipos.");
    }
    const key = `branding/platform/${input.target}-${Date.now()}.${prepared.extension}`;
    await this.storage.putObject({
      key,
      body: new Uint8Array(prepared.body),
      contentType: input.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    });
    return { url: this.storage.publicUrl(key) };
  }
}
