import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient, BrandProfile } from "@impulza/database";
import type { BrandProfileResponse, ResolvedBrandResponse, UploadBrandProfileAssetResponse } from "@impulza/contracts";
import {
  brandEmail,
  resolveOrganizationBrand,
  type BrandableEmail,
  type OrganizationBrandRow,
  type UpdateBrandProfileDto,
  type UploadBrandingAssetDto,
} from "@impulza/validation";
import type { StorageAdapter } from "@impulza/storage";
import { PRISMA } from "../../database/prisma.module.js";
import { STORAGE } from "../../storage/storage.module.js";
import { AuditService } from "../audit/audit.service.js";
import { prepareBrandingAsset } from "../platform-branding/branding-asset.js";
import { PlatformBrandingService } from "../platform-branding/platform-branding.service.js";
import { logger } from "../../observability/logger.js";

/** Prefijo del almacenamiento donde viven —y solo donde pueden vivir— los logos de una organización. */
export function organizationBrandingPrefix(organizationId: string): string {
  return `branding/org/${organizationId}/`;
}

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

  /** Lo que la organización configuró (sin respaldo de plataforma): base de los valores por defecto de sus páginas. */
  async getOwnBrand(organizationId: string): Promise<OrganizationBrandRow | null> {
    return this.prisma.brandProfile.findUnique({
      where: { organizationId },
      select: {
        displayName: true,
        logoLightUrl: true,
        logoDarkUrl: true,
        faviconUrl: true,
        primaryColor: true,
        secondaryColor: true,
        contactEmail: true,
      },
    });
  }

  /**
   * Marca efectiva de la organización (ADR-028 §4). La regla de la cascada vive en `@impulza/validation`
   * (`cascadeBrand`) y la comparten la API y el worker: acá solo se aportan los datos. Nunca lanza.
   */
  async resolveBrand(organizationId: string): Promise<ResolvedBrandResponse> {
    return resolveOrganizationBrand(
      {
        organization: (id) => this.getOwnBrand(id),
        platform: () => this.platformBrandingService.getPublic(),
      },
      organizationId,
    );
  }

  /**
   * Correo que la organización envía a sus propios clientes, con su marca (F9.2 criterio 4b). Si resolver la
   * marca falla, el correo sale tal cual: la marca nunca debe impedir una confirmación de reserva.
   */
  async brandEmail<T extends BrandableEmail>(organizationId: string, message: T): Promise<T> {
    try {
      return brandEmail(message, await this.resolveBrand(organizationId));
    } catch (error) {
      logger.warn("brand-profile: no se pudo aplicar la marca a un correo; se envía sin ella", {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return message;
    }
  }

  async getByOrg(organizationId: string): Promise<BrandProfileResponse> {
    // `upsert` y no «buscar y crear»: dos primeras lecturas simultáneas no pueden chocar con la restricción única.
    const profile = await this.prisma.brandProfile.upsert({
      where: { organizationId },
      update: {},
      create: { organizationId },
    });
    return this.toResponse(profile);
  }

  /**
   * Un logo o favicon solo puede ser un archivo subido por **esta** organización a su espacio de marca. Una URL
   * externa se aceptaría como píxel de rastreo en los correos y portales donde aparece la marca, y una URL del
   * espacio de otra organización cruzaría el aislamiento (ADR-002).
   */
  private assertOwnAsset(organizationId: string, label: string, url: string | null | undefined): void {
    if (!url) return;
    if (!this.storage) {
      throw new BadRequestException("El almacenamiento de archivos no está configurado: no se pueden guardar logotipos.");
    }
    if (!url.startsWith(this.storage.publicUrl(organizationBrandingPrefix(organizationId)))) {
      throw new BadRequestException(`${label}: usa un archivo subido desde esta pantalla; no se aceptan enlaces externos.`);
    }
  }

  async update(actorId: string, organizationId: string, input: UpdateBrandProfileDto): Promise<BrandProfileResponse> {
    this.assertOwnAsset(organizationId, "Logo para fondo claro", input.logoLightUrl);
    this.assertOwnAsset(organizationId, "Logo para fondo oscuro", input.logoDarkUrl);
    this.assertOwnAsset(organizationId, "Favicon", input.faviconUrl);

    const previous = await this.prisma.brandProfile.findUnique({ where: { organizationId } });
    const data = {
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
    };

    const updated = await this.prisma.brandProfile.upsert({
      where: { organizationId },
      update: { ...data, updatedAt: new Date() },
      create: { organizationId, ...data },
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
          ? { displayName: previous.displayName, primaryColor: previous.primaryColor, secondaryColor: previous.secondaryColor }
          : null,
      },
    });

    logger.info("brand-profile: perfil de marca de organización actualizado", { organizationId, actorId });
    return this.toResponse(updated);
  }

  /** La validación del archivo es la misma que la de la plataforma (`prepareBrandingAsset`). */
  async uploadAsset(_actorId: string, organizationId: string, input: UploadBrandingAssetDto): Promise<UploadBrandProfileAssetResponse> {
    const prepared = await prepareBrandingAsset(input);

    if (!this.storage) {
      throw new ServiceUnavailableException("El almacenamiento de archivos no está configurado. Configúralo para subir logotipos.");
    }
    const key = `${organizationBrandingPrefix(organizationId)}${input.target}-${Date.now()}.${prepared.extension}`;
    await this.storage.putObject({
      key,
      body: new Uint8Array(prepared.body),
      contentType: input.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    });
    return { url: this.storage.publicUrl(key) };
  }
}
