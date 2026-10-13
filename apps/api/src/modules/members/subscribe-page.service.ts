import { createHmac } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import type { PublicSubscribePageResponse, SubscribePageAdminResponse } from "@impulza/contracts";
import { SiteMemberSource, SiteMemberStatus, type PrismaClient } from "@impulza/database";
import { MEMBER_LOGIN_TOKEN_TTL_MINUTES, MEMBERS_PER_SITE_MAX, SUBSCRIBE_HONEYPOT_FIELD, subscribePath, type FreeSubscribeDto, type SubscribePageDto } from "@impulza/validation";
import type { Redis } from "ioredis";
import { SERVED_SITE } from "../../common/active-organization.js";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { REDIS } from "../../redis/redis.module.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { BrandProfileService } from "../brand-profile/brand-profile.service.js";
import { MembersService } from "./members.service.js";

const SITE_NOT_FOUND = "Sitio no encontrado.";
const PAGE_NOT_FOUND = "La página de suscripción no existe o no está activa.";
/** Altas gratuitas por correo y sitio en la ventana: más allá, se responde igual pero no se envía nada. */
const FREE_PER_EMAIL_LIMIT = 3;
const FREE_WINDOW_SECONDS = 600;

type PageRow = NonNullable<Awaited<ReturnType<PrismaClient["subscribePage"]["findUnique"]>>>;

function benefitsOf(row: PageRow): string[] {
  return Array.isArray(row.benefits) ? row.benefits.filter((item): item is string => typeof item === "string") : [];
}

function fieldsOf(row: PageRow) {
  return { title: row.title, description: row.description, benefits: benefitsOf(row), freeEnabled: row.freeEnabled, imageUrl: row.imageUrl };
}

/** Dirección pública de la página de suscripción de un sitio. */
export function subscribePublicUrl(siteSlug: string): string | null {
  return env.PUBLIC_SITE_BASE_URL ? `${env.PUBLIC_SITE_BASE_URL.replace(/\/+$/, "")}${subscribePath(siteSlug)}` : null;
}

/**
 * Página de suscripción del sitio: edición desde el panel, vista pública y suscripción gratuita (extra F10, ADR-029). La
 * suscripción de pago NO vive acá: reutiliza los planes y el cobro de membresías (`MembershipCheckoutService`).
 */
@Injectable()
export class SubscribePageService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BrandProfileService) private readonly brandProfile: BrandProfileService,
    @Inject(MembersService) private readonly members: MembersService,
  ) {}

  // ───────────────────────────── Panel ─────────────────────────────

  private async siteOf(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true, slug: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    return site;
  }

  private async adminView(siteId: string, organizationId: string, siteSlug: string, row: PageRow | null): Promise<SubscribePageAdminResponse> {
    const activeMembers = await this.prisma.siteMember.count({ where: { siteId, organizationId, status: SiteMemberStatus.ACTIVE } });
    return {
      page: row ? { ...fieldsOf(row), enabled: row.enabled, updatedAt: row.updatedAt.toISOString() } : null,
      publicUrl: subscribePublicUrl(siteSlug),
      activeMembers,
    };
  }

  async get(organizationId: string, siteId: string): Promise<SubscribePageAdminResponse> {
    const site = await this.siteOf(organizationId, siteId);
    const row = await this.prisma.subscribePage.findUnique({ where: { siteId } });
    return this.adminView(siteId, organizationId, site.slug, row);
  }

  async save(organizationId: string, siteId: string, actorId: string, dto: SubscribePageDto): Promise<SubscribePageAdminResponse> {
    const site = await this.siteOf(organizationId, siteId);
    const data = {
      enabled: dto.enabled,
      title: dto.title,
      description: dto.description ?? null,
      benefits: dto.benefits,
      freeEnabled: dto.freeEnabled,
      imageUrl: dto.imageUrl ?? null,
    };
    // `organizationId` solo se escribe al crear: una página nunca cambia de organización.
    const row = await this.prisma.subscribePage.upsert({ where: { siteId }, create: { organizationId, siteId, ...data }, update: data });
    await this.audit.record({
      organizationId,
      actorId,
      action: "subscribe_page.updated",
      targetType: "SubscribePage",
      targetId: row.id,
      metadata: { siteId, enabled: row.enabled, freeEnabled: row.freeEnabled },
    });
    return this.adminView(siteId, organizationId, site.slug, row);
  }

  // ───────────────────────────── Público ─────────────────────────────

  private async activePage(siteSlug: string): Promise<{ site: { id: string; name: string; slug: string; organizationId: string }; row: PageRow }> {
    const site = await this.prisma.site.findFirst({ where: { slug: siteSlug, ...SERVED_SITE }, select: { id: true, name: true, slug: true, organizationId: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    const row = await this.prisma.subscribePage.findUnique({ where: { siteId: site.id } });
    if (!row || !row.enabled) throw new NotFoundException(PAGE_NOT_FOUND);
    return { site, row };
  }

  async publicView(siteSlug: string): Promise<PublicSubscribePageResponse> {
    const { site, row } = await this.activePage(siteSlug);
    return { ...fieldsOf(row), siteName: site.name, siteSlug: site.slug };
  }

  /**
   * Suscripción gratuita: crea (o reutiliza) al miembro `FREE` y le envía su enlace de acceso. La respuesta es la misma pase lo
   * que pase: correo nuevo, ya suscrito, revocado, límite por correo o tope del sitio. Nadie puede averiguar quién es suscriptor,
   * y un correo ajeno solo recibe un enlace que no usará (el acceso exige abrirlo desde esa bandeja).
   */
  async subscribeFree(siteSlug: string, dto: FreeSubscribeDto): Promise<void> {
    const { site, row } = await this.activePage(siteSlug);
    if (!row.freeEnabled) throw new NotFoundException(PAGE_NOT_FOUND);

    // Campo trampa: éxito aparente, nada guardado ni enviado.
    const trap = dto[SUBSCRIBE_HONEYPOT_FIELD];
    if (typeof trap === "string" && trap.trim().length > 0) {
      logger.info("suscripción: honeypot", { siteId: site.id });
      return;
    }

    const digest = createHmac("sha256", env.INTERNAL_PROXY_SECRET).update(dto.email).digest("hex");
    const key = `free-subscribe:${site.id}:${digest}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, FREE_WINDOW_SECONDS);
    if (count > FREE_PER_EMAIL_LIMIT) return;

    let member = await this.prisma.siteMember.findUnique({ where: { siteId_email: { siteId: site.id, email: dto.email } }, select: { id: true, status: true } });
    if (member && member.status !== SiteMemberStatus.ACTIVE) return;
    let created = false;
    if (!member) {
      if ((await this.prisma.siteMember.count({ where: { siteId: site.id } })) >= MEMBERS_PER_SITE_MAX) return;
      try {
        member = await this.prisma.siteMember.create({
          data: { organizationId: site.organizationId, siteId: site.id, email: dto.email, name: dto.name ?? null, source: SiteMemberSource.FREE },
          select: { id: true, status: true },
        });
        created = true;
      } catch (error) {
        // Dos altas simultáneas con el mismo correo: gana la primera fila.
        if (!isUniqueViolation(error)) throw error;
        member = await this.prisma.siteMember.findUnique({ where: { siteId_email: { siteId: site.id, email: dto.email } }, select: { id: true, status: true } });
        if (!member || member.status !== SiteMemberStatus.ACTIVE) return;
      }
    }

    if (created) {
      await this.audit.record({
        organizationId: site.organizationId,
        actorId: null,
        action: "subscribe_page.free_subscribed",
        targetType: "SiteMember",
        targetId: member.id,
        metadata: { siteId: site.id },
      });
    }
    const memberId = member.id;
    void this.sendWelcome(site, memberId, dto.email, created).catch((error) => logger.error("no se pudo enviar el enlace de suscripción", { siteId: site.id, error }));
  }

  private async sendWelcome(site: { id: string; name: string; organizationId: string }, memberId: string, email: string, created: boolean): Promise<void> {
    const link = await this.members.createLoginLink(site.id, memberId);
    if (!link) return;
    const text = [
      `Hola:`,
      ``,
      created ? `Te suscribiste a ${site.name}. Entra con este enlace:` : `Este es tu enlace para entrar a ${site.name}:`,
      link,
      ``,
      `Vence en ${MEMBER_LOGIN_TOKEN_TTL_MINUTES} minutos y sirve una sola vez. Si no fuiste tú, ignora este correo: nadie entra sin este enlace.`,
    ].join("\n");
    await this.email.send(await this.brandProfile.brandEmail(site.organizationId, { to: email, subject: `Tu suscripción a ${site.name}`, text }));
  }
}
