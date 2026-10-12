import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { DigitalCardAdminResponse, PublicDigitalCardResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { buildVCard, vCardFileName, type DigitalCardDto } from "@impulza/validation";
import { SERVED_SITE } from "../../common/active-organization.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { AuditService } from "../audit/audit.service.js";
import { WALLET_PASS_PROVIDERS } from "./digital-card.tokens.js";
import { WalletUnavailableError, type WalletCardData, type WalletPassProvider, type WalletPassResult } from "./wallet/wallet-pass.provider.js";

const SITE_NOT_FOUND = "Sitio no encontrado.";
const CARD_NOT_FOUND = "La tarjeta no existe o no está activa.";

type CardRow = NonNullable<Awaited<ReturnType<PrismaClient["digitalCard"]["findUnique"]>>>;

function socialsOf(row: CardRow): Array<{ network: string; url: string }> {
  const value = row.socials;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { network: string; url: string } => typeof item === "object" && item !== null && typeof (item as { url?: unknown }).url === "string" && typeof (item as { network?: unknown }).network === "string");
}

function fieldsOf(row: CardRow) {
  return {
    fullName: row.fullName,
    jobTitle: row.jobTitle,
    company: row.company,
    bio: row.bio,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    website: row.website,
    address: row.address,
    photoUrl: row.photoUrl,
    socials: socialsOf(row),
  };
}

/** Página pública de la tarjeta de un sitio. */
export function cardPublicUrl(siteSlug: string): string | null {
  return env.PUBLIC_SITE_BASE_URL ? `${env.PUBLIC_SITE_BASE_URL.replace(/\/+$/, "")}/${siteSlug}/t` : null;
}

/** Tarjeta digital de un sitio: edición desde el panel, página pública, vCard y pases de wallet (F10.4, ADR-029). */
@Injectable()
export class DigitalCardService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(WALLET_PASS_PROVIDERS) private readonly providers: WalletPassProvider[],
  ) {}

  private walletAvailability(): { google: boolean; apple: boolean } {
    const has = (id: "google" | "apple") => this.providers.some((provider) => provider.id === id && provider.isConfigured());
    return { google: has("google"), apple: has("apple") };
  }

  // ───────────────────────────── Panel ─────────────────────────────

  private async siteOf(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true, slug: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    return site;
  }

  private adminView(row: CardRow | null, siteSlug: string): DigitalCardAdminResponse {
    return {
      card: row ? { ...fieldsOf(row), enabled: row.enabled, updatedAt: row.updatedAt.toISOString() } : null,
      publicUrl: cardPublicUrl(siteSlug),
      wallet: this.walletAvailability(),
    };
  }

  async get(organizationId: string, siteId: string): Promise<DigitalCardAdminResponse> {
    const site = await this.siteOf(organizationId, siteId);
    const row = await this.prisma.digitalCard.findUnique({ where: { siteId } });
    return this.adminView(row, site.slug);
  }

  async save(organizationId: string, siteId: string, actorId: string, dto: DigitalCardDto): Promise<DigitalCardAdminResponse> {
    const site = await this.siteOf(organizationId, siteId);
    const data = {
      enabled: dto.enabled,
      fullName: dto.fullName,
      jobTitle: dto.jobTitle ?? null,
      company: dto.company ?? null,
      bio: dto.bio ?? null,
      phone: dto.phone ?? null,
      whatsapp: dto.whatsapp ?? null,
      email: dto.email ?? null,
      website: dto.website ?? null,
      address: dto.address ?? null,
      photoUrl: dto.photoUrl ?? null,
      socials: dto.socials,
    };
    // `organizationId` solo se escribe al crear: una tarjeta nunca cambia de organización.
    const row = await this.prisma.digitalCard.upsert({ where: { siteId }, create: { organizationId, siteId, ...data }, update: data });
    await this.audit.record({
      organizationId,
      actorId,
      action: "digital_card.updated",
      targetType: "DigitalCard",
      targetId: row.id,
      metadata: { siteId, enabled: row.enabled },
    });
    return this.adminView(row, site.slug);
  }

  // ───────────────────────────── Público ─────────────────────────────

  private async activeCard(siteSlug: string): Promise<{ site: { id: string; name: string; slug: string }; row: CardRow }> {
    const site = await this.prisma.site.findFirst({ where: { slug: siteSlug, ...SERVED_SITE }, select: { id: true, name: true, slug: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    const row = await this.prisma.digitalCard.findUnique({ where: { siteId: site.id } });
    if (!row || !row.enabled) throw new NotFoundException(CARD_NOT_FOUND);
    return { site, row };
  }

  async publicView(siteSlug: string): Promise<PublicDigitalCardResponse> {
    const { site, row } = await this.activeCard(siteSlug);
    return { ...fieldsOf(row), siteName: site.name, siteSlug: site.slug, wallet: this.walletAvailability() };
  }

  async vcard(siteSlug: string): Promise<{ fileName: string; content: string }> {
    const { site, row } = await this.activeCard(siteSlug);
    const cardUrl = cardPublicUrl(site.slug) ?? `https://example.invalid/${site.slug}/t`;
    return { fileName: vCardFileName(row.fullName), content: buildVCard(fieldsOf(row), { cardUrl, uid: row.id }) };
  }

  /** Pase de wallet de la tarjeta. Sin credenciales del proveedor: 503 con un mensaje claro (la tarjeta y la vCard siguen). */
  async wallet(siteSlug: string, provider: "google" | "apple"): Promise<WalletPassResult> {
    const { site, row } = await this.activeCard(siteSlug);
    const adapter = this.providers.find((item) => item.id === provider);
    const name = provider === "google" ? "Google Wallet" : "Apple Wallet";
    if (!adapter || !adapter.isConfigured()) {
      throw new ServiceUnavailableException({ statusCode: 503, error: "Service Unavailable", code: "WALLET_UNAVAILABLE", message: `${name} no está disponible ahora. Puedes guardar el contacto con la vCard.` });
    }
    const cardUrl = cardPublicUrl(site.slug);
    if (!cardUrl) {
      throw new ServiceUnavailableException({ statusCode: 503, error: "Service Unavailable", code: "WALLET_UNAVAILABLE", message: `${name} no está disponible ahora.` });
    }
    const data: WalletCardData = {
      serialNumber: site.id.replace(/-/g, ""),
      siteName: site.name,
      fullName: row.fullName,
      jobTitle: row.jobTitle,
      company: row.company,
      email: row.email,
      phone: row.phone,
      website: row.website,
      cardUrl,
    };
    try {
      return await adapter.create(data);
    } catch (error) {
      if (error instanceof WalletUnavailableError) {
        throw new ServiceUnavailableException({ statusCode: 503, error: "Service Unavailable", code: "WALLET_UNAVAILABLE", message: `${name} no está disponible ahora.` });
      }
      throw error;
    }
  }
}
