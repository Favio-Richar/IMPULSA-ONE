import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { AgencyClientStatus, type PrismaClient } from "@impulza/database";
import type { PanelBrandResponse, UploadBrandProfileAssetResponse, WhiteLabelSettingsResponse } from "@impulza/contracts";
import { brandNameKey, whiteLabelFooter, type UpdateWhiteLabelDto, type UploadBrandingAssetDto } from "@impulza/validation";
import type { StorageAdapter } from "@impulza/storage";
import { PRISMA } from "../../database/prisma.module.js";
import { STORAGE } from "../../storage/storage.module.js";
import { AuditService } from "../audit/audit.service.js";
import { BrandProfileService } from "../brand-profile/brand-profile.service.js";
import { prepareBrandingAsset } from "../platform-branding/branding-asset.js";
import { PlatformBrandingService } from "../platform-branding/platform-branding.service.js";
import { AgencyService } from "./agency.service.js";

/** Donde viven —y solo donde pueden vivir— los logos de la marca blanca de una agencia. */
export function whiteLabelBrandingPrefix(agencyOrganizationId: string): string {
  return `branding/agency/${agencyOrganizationId}/`;
}

type SettingsRow = {
  displayName: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  supportEmail: string | null;
  footerText: string | null;
  updatedAt: Date;
};

/**
 * Marca blanca de una agencia (F9.7a, ADR-028 §4). Reglas que se aplican aquí, en el servidor:
 * - solo una agencia la tiene; los logos son archivos subidos por ELLA a su espacio (nunca una URL externa ni de otra organización);
 * - el nombre no puede ser el de la plataforma, el de otra marca blanca ni el de un negocio ajeno (suplantación);
 * - no se activa para un cliente sin marca configurada, ni para uno cuya relación no está activa, ni de otra agencia;
 * - cada cambio queda en la auditoría de la agencia y, si es por cliente, también en la del cliente (transparencia).
 */
@Injectable()
export class WhiteLabelService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(STORAGE) private readonly storage: StorageAdapter | null,
    private readonly auditService: AuditService,
    private readonly agencyService: AgencyService,
    private readonly brandProfileService: BrandProfileService,
    private readonly platformBrandingService: PlatformBrandingService,
  ) {}

  private toResponse(row: SettingsRow | null, enabledClients: number): WhiteLabelSettingsResponse {
    return {
      displayName: row?.displayName ?? null,
      logoLightUrl: row?.logoLightUrl ?? null,
      logoDarkUrl: row?.logoDarkUrl ?? null,
      faviconUrl: row?.faviconUrl ?? null,
      primaryColor: row?.primaryColor ?? null,
      secondaryColor: row?.secondaryColor ?? null,
      supportEmail: row?.supportEmail ?? null,
      footerText: row?.footerText ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      enabledClients,
    };
  }

  async get(agencyOrganizationId: string): Promise<WhiteLabelSettingsResponse> {
    await this.agencyService.assertAgency(agencyOrganizationId);
    const [row, enabledClients] = await Promise.all([
      this.prisma.whiteLabelSettings.findUnique({ where: { agencyOrganizationId } }),
      this.prisma.agencyClient.count({ where: { agencyOrganizationId, whiteLabelEnabled: true } }),
    ]);
    return this.toResponse(row, enabledClients);
  }

  private assertOwnAsset(agencyOrganizationId: string, label: string, url: string | null | undefined): void {
    if (!url) return;
    if (!this.storage) {
      throw new BadRequestException("El almacenamiento de archivos no está configurado: no se pueden guardar logotipos.");
    }
    if (!url.startsWith(this.storage.publicUrl(whiteLabelBrandingPrefix(agencyOrganizationId)))) {
      throw new BadRequestException(`${label}: usa un archivo subido desde esta pantalla; no se aceptan enlaces externos.`);
    }
  }

  /** El nombre no puede hacerse pasar por la plataforma, por otra marca blanca ni por un negocio que no es cliente de esta agencia. */
  private async assertNameNotImpersonating(agencyOrganizationId: string, name: string): Promise<void> {
    const key = brandNameKey(name);
    if (key.length < 2) throw new BadRequestException("El nombre debe tener letras o números.");

    const [platform, otherWhiteLabels, clients] = await Promise.all([
      this.platformBrandingService.getPublic(),
      this.prisma.whiteLabelSettings.findMany({
        where: { agencyOrganizationId: { not: agencyOrganizationId }, displayName: { not: null } },
        select: { displayName: true },
      }),
      this.prisma.agencyClient.findMany({ where: { agencyOrganizationId }, select: { clientOrganizationId: true } }),
    ]);
    const ownIds = [agencyOrganizationId, ...clients.map((client) => client.clientOrganizationId)];
    const taken = (): never => {
      throw new ConflictException({ statusCode: 409, error: "Conflict", code: "BRAND_NAME_TAKEN", message: "Ese nombre ya lo usa otra marca: elige uno que sea tuyo." });
    };

    if (platform && brandNameKey(platform.name) === key) taken();
    if (otherWhiteLabels.some((other) => other.displayName !== null && brandNameKey(other.displayName) === key)) taken();
    // Negocios y marcas de organizaciones que no son esta agencia ni sus clientes.
    const [organization, profile] = await Promise.all([
      this.prisma.organization.findFirst({ where: { id: { notIn: ownIds }, name: { equals: name.trim(), mode: "insensitive" } }, select: { id: true } }),
      this.prisma.brandProfile.findFirst({ where: { organizationId: { notIn: ownIds }, displayName: { equals: name.trim(), mode: "insensitive" } }, select: { id: true } }),
    ]);
    if (organization || profile) taken();
  }

  async update(agencyOrganizationId: string, actorId: string, input: UpdateWhiteLabelDto): Promise<WhiteLabelSettingsResponse> {
    await this.agencyService.assertAgency(agencyOrganizationId);
    this.assertOwnAsset(agencyOrganizationId, "Logo para fondo claro", input.logoLightUrl);
    this.assertOwnAsset(agencyOrganizationId, "Logo para fondo oscuro", input.logoDarkUrl);
    this.assertOwnAsset(agencyOrganizationId, "Favicon", input.faviconUrl);

    const enabledClients = await this.prisma.agencyClient.count({ where: { agencyOrganizationId, whiteLabelEnabled: true } });
    if (!input.displayName) {
      if (enabledClients > 0) {
        throw new ConflictException({
          statusCode: 409,
          error: "Conflict",
          code: "WHITE_LABEL_IN_USE",
          message: `La marca está activa en ${enabledClients} cliente${enabledClients === 1 ? "" : "s"}: desactívala en ellos antes de quitar el nombre.`,
        });
      }
    } else {
      await this.assertNameNotImpersonating(agencyOrganizationId, input.displayName);
    }

    const data = {
      displayName: input.displayName ?? null,
      logoLightUrl: input.logoLightUrl ?? null,
      logoDarkUrl: input.logoDarkUrl ?? null,
      faviconUrl: input.faviconUrl ?? null,
      primaryColor: input.primaryColor ?? null,
      secondaryColor: input.secondaryColor ?? null,
      supportEmail: input.supportEmail ?? null,
      footerText: whiteLabelFooter(input.footerText),
    };
    const row = await this.prisma.whiteLabelSettings.upsert({
      where: { agencyOrganizationId },
      update: data,
      create: { agencyOrganizationId, ...data },
    });
    await this.auditService.record({
      organizationId: agencyOrganizationId,
      actorId,
      action: "agency.white_label_updated",
      targetType: "WhiteLabelSettings",
      targetId: row.id,
      metadata: { displayName: row.displayName, enabledClients },
    });
    return this.toResponse(row, enabledClients);
  }

  async upload(agencyOrganizationId: string, input: UploadBrandingAssetDto): Promise<UploadBrandProfileAssetResponse> {
    await this.agencyService.assertAgency(agencyOrganizationId);
    const prepared = await prepareBrandingAsset(input);
    if (!this.storage) {
      throw new ServiceUnavailableException("El almacenamiento de archivos no está configurado. Configúralo para subir logotipos.");
    }
    const key = `${whiteLabelBrandingPrefix(agencyOrganizationId)}${input.target}-${Date.now()}.${prepared.extension}`;
    await this.storage.putObject({
      key,
      body: new Uint8Array(prepared.body),
      contentType: input.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    });
    return { url: this.storage.publicUrl(key) };
  }

  /** Activa o desactiva la marca blanca para UN cliente de esta agencia. */
  async setForClient(agencyOrganizationId: string, actorId: string, relationId: string, enabled: boolean): Promise<{ id: string; whiteLabelEnabled: boolean }> {
    await this.agencyService.assertAgency(agencyOrganizationId);
    // Filtrada por agencia: la relación de otra agencia es un 404 (ADR-002).
    const relation = await this.prisma.agencyClient.findFirst({ where: { id: relationId, agencyOrganizationId } });
    if (!relation) throw new NotFoundException("Cliente no encontrado.");

    if (enabled) {
      const current = relation.status === AgencyClientStatus.ACTIVE || (relation.status === AgencyClientStatus.INVITED && relation.agencyCreated);
      if (!current) {
        throw new ConflictException({ statusCode: 409, error: "Conflict", code: "CLIENT_NOT_ACTIVE", message: "La marca blanca solo se activa en clientes con la relación activa." });
      }
      const settings = await this.prisma.whiteLabelSettings.findUnique({ where: { agencyOrganizationId }, select: { displayName: true } });
      if (!settings?.displayName) {
        throw new ConflictException({ statusCode: 409, error: "Conflict", code: "WHITE_LABEL_NOT_CONFIGURED", message: "Configura el nombre de tu marca antes de activarla en un cliente." });
      }
    }

    const updated = await this.prisma.agencyClient.update({ where: { id: relation.id }, data: { whiteLabelEnabled: enabled } });
    const metadata = { agencyOrganizationId, agencyClientId: relation.id, enabled };
    await this.auditService.record({ organizationId: agencyOrganizationId, actorId, action: "agency.white_label_client_changed", targetType: "AgencyClient", targetId: relation.id, metadata });
    // El cliente ve en su propia auditoría que su panel cambió de marca.
    await this.auditService.record({ organizationId: relation.clientOrganizationId, actorId, action: "agency.white_label_client_changed", targetType: "AgencyClient", targetId: relation.id, metadata });
    return { id: updated.id, whiteLabelEnabled: updated.whiteLabelEnabled };
  }

  /** La marca que debe vestir el panel de esta organización, o `null` si corresponde la de la plataforma. */
  async panelBrand(organizationId: string): Promise<PanelBrandResponse> {
    const brand = await this.brandProfileService.resolveBrand(organizationId, "team");
    if (!brand.whiteLabel) return { brand: null };
    return {
      brand: {
        displayName: brand.displayName,
        logoLightUrl: brand.logoLightUrl,
        logoDarkUrl: brand.logoDarkUrl,
        faviconUrl: brand.faviconUrl,
        primaryColor: brand.primaryColor,
        secondaryColor: brand.secondaryColor,
        supportEmail: brand.contactEmail,
        footerText: brand.whiteLabel.footerText,
        agencyName: brand.whiteLabel.agencyName,
      },
    };
  }
}
