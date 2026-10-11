import { createHash, createHmac, randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import type { MemberSessionResponse, MemberSettingsResponse, SiteMemberListResponse, SiteMemberResponse } from "@impulza/contracts";
import { Prisma, SiteMemberStatus, type PrismaClient } from "@impulza/database";
import {
  MEMBER_LOGIN_TOKEN_TTL_MINUTES,
  MEMBER_SESSION_TTL_DAYS,
  MEMBER_TOKEN_PATTERN,
  MEMBERS_PER_SITE_MAX,
  type AddMemberDto,
  type ListMembersQueryDto,
} from "@impulza/validation";
import type { Redis } from "ioredis";
import { SERVED_SITE } from "../../common/active-organization.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { REDIS } from "../../redis/redis.module.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { BrandProfileService } from "../brand-profile/brand-profile.service.js";
import { PublicSitesService, type PublicPageView } from "../public-sites/public-sites.service.js";
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";

const INVALID_LINK = "Este enlace no es válido o ya venció. Pide uno nuevo.";
const SITE_NOT_FOUND = "Sitio no encontrado.";
/** Pedidos de enlace por correo y sitio en la ventana: más allá, se responde igual pero no se envía nada. */
const ACCESS_PER_EMAIL_LIMIT = 3;
const ACCESS_WINDOW_SECONDS = 600;

export const hashMemberToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const newToken = (): string => randomBytes(32).toString("base64url");

/**
 * Miembros de sitio y contenido protegido (F10.1, ADR-029). Identidad propia (`SiteMember`), nunca `User`: ningún fallo
 * acá abre el panel. Los tokens (enlace y sesión) son de 256 bits y solo se guarda su SHA-256.
 */
@Injectable()
export class MembersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BrandProfileService) private readonly brandProfile: BrandProfileService,
    @Inject(PublicSitesService) private readonly publicSites: PublicSitesService,
    @Inject(RevalidateWebService) private readonly revalidateWeb: RevalidateWebService,
  ) {}

  // ───────────────────────────── Superficie pública ─────────────────────────────

  private async servedSite(siteSlug: string) {
    const site = await this.prisma.site.findFirst({ where: { slug: siteSlug, ...SERVED_SITE }, select: { id: true, name: true, slug: true, organizationId: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    return site;
  }

  /**
   * El visitante pide su enlace. La respuesta es la misma exista o no como miembro, esté revocado o haya excedido el límite:
   * nadie puede averiguar quién es miembro. El correo se envía sin esperar, para que tampoco lo delate el tiempo.
   */
  async requestAccess(siteSlug: string, email: string): Promise<void> {
    const site = await this.servedSite(siteSlug);

    const digest = createHmac("sha256", env.INTERNAL_PROXY_SECRET).update(email).digest("hex");
    const key = `member-access:${site.id}:${digest}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, ACCESS_WINDOW_SECONDS);
    if (count > ACCESS_PER_EMAIL_LIMIT) return;

    const member = await this.prisma.siteMember.findUnique({ where: { siteId_email: { siteId: site.id, email } }, select: { id: true, status: true } });
    if (!member || member.status !== SiteMemberStatus.ACTIVE) return;

    void this.sendAccessLink(site, member.id, email).catch((error) => logger.error("no se pudo enviar el enlace de acceso de miembro", { siteId: site.id, error }));
  }

  private async sendAccessLink(site: { id: string; name: string; organizationId: string }, memberId: string, email: string): Promise<void> {
    const token = newToken();
    await this.prisma.siteMemberLoginToken.create({
      data: { memberId, tokenHash: hashMemberToken(token), expiresAt: new Date(Date.now() + MEMBER_LOGIN_TOKEN_TTL_MINUTES * 60_000) },
    });
    if (!env.PUBLIC_SITE_BASE_URL) {
      logger.warn("PUBLIC_SITE_BASE_URL no está configurado: no se puede armar el enlace de acceso de miembro", { siteId: site.id });
      return;
    }
    const link = `${env.PUBLIC_SITE_BASE_URL.replace(/\/$/, "")}/miembros/${token}`;
    const text = [
      `Hola:`,
      ``,
      `Este es tu enlace para entrar al contenido para miembros de ${site.name}:`,
      link,
      ``,
      `Vence en ${MEMBER_LOGIN_TOKEN_TTL_MINUTES} minutos y sirve una sola vez. Si no lo pediste, ignora este correo: nadie entra sin este enlace.`,
    ].join("\n");
    await this.email.send(await this.brandProfile.brandEmail(site.organizationId, { to: email, subject: `Tu acceso a ${site.name}`, text }));
  }

  /** Canjea el enlace de un solo uso por una sesión. Todo fallo responde igual: no se distingue vencido, usado o inexistente. */
  async verify(token: string): Promise<MemberSessionResponse> {
    if (!MEMBER_TOKEN_PATTERN.test(token)) throw new UnauthorizedException(INVALID_LINK);
    const record = await this.prisma.siteMemberLoginToken.findUnique({
      where: { tokenHash: hashMemberToken(token) },
      include: { member: { include: { site: { select: { slug: true, status: true, moderationHiddenAt: true, organization: { select: { status: true, publicHiddenAt: true } } } } } } },
    });
    const now = new Date();
    const site = record?.member.site;
    const reachable = site && site.status !== "ARCHIVED" && site.moderationHiddenAt === null && site.organization.status === "ACTIVE" && site.organization.publicHiddenAt === null;
    if (!record || !reachable || record.member.status !== SiteMemberStatus.ACTIVE || record.usedAt || record.expiresAt <= now) {
      throw new UnauthorizedException(INVALID_LINK);
    }

    // Un solo uso, también ante dos canjes simultáneos: gana quien marca `usedAt` primero.
    const claimed = await this.prisma.siteMemberLoginToken.updateMany({ where: { id: record.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count === 0) throw new UnauthorizedException(INVALID_LINK);

    const sessionToken = newToken();
    const expiresAt = new Date(now.getTime() + MEMBER_SESSION_TTL_DAYS * 86_400_000);
    await this.prisma.$transaction([
      this.prisma.siteMemberSession.create({ data: { memberId: record.memberId, tokenHash: hashMemberToken(sessionToken), expiresAt } }),
      this.prisma.siteMember.update({ where: { id: record.memberId }, data: { lastAccessAt: now } }),
    ]);
    return { siteSlug: site.slug, sessionToken, expiresAt: expiresAt.toISOString() };
  }

  /** Sesión válida DE ESTE SITIO: vigente, no revocada, miembro activo y sitio servido. Cualquier otra cosa, 401. */
  async authenticate(siteSlug: string, sessionToken: string | undefined): Promise<{ id: string; email: string; name: string | null; siteId: string }> {
    if (!sessionToken || !MEMBER_TOKEN_PATTERN.test(sessionToken)) throw new UnauthorizedException("Necesitas iniciar sesión como miembro.");
    const session = await this.prisma.siteMemberSession.findUnique({
      where: { tokenHash: hashMemberToken(sessionToken) },
      include: { member: { include: { site: { select: { id: true, slug: true, status: true, moderationHiddenAt: true, organization: { select: { status: true, publicHiddenAt: true } } } } } } },
    });
    const site = session?.member.site;
    if (
      !session ||
      !site ||
      site.slug !== siteSlug ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.member.status !== SiteMemberStatus.ACTIVE ||
      site.status === "ARCHIVED" ||
      site.moderationHiddenAt !== null ||
      site.organization.status !== "ACTIVE" ||
      site.organization.publicHiddenAt !== null
    ) {
      throw new UnauthorizedException("Necesitas iniciar sesión como miembro.");
    }
    return { id: session.member.id, email: session.member.email, name: session.member.name, siteId: site.id };
  }

  async getMemberPage(siteSlug: string, pageSlug: string, sessionToken: string | undefined): Promise<PublicPageView> {
    await this.authenticate(siteSlug, sessionToken);
    return this.publicSites.getPage(siteSlug, pageSlug, { memberAccess: true });
  }

  async logout(siteSlug: string, sessionToken: string | undefined): Promise<void> {
    if (!sessionToken || !MEMBER_TOKEN_PATTERN.test(sessionToken)) return;
    await this.prisma.siteMemberSession.updateMany({
      where: { tokenHash: hashMemberToken(sessionToken), revokedAt: null, member: { site: { slug: siteSlug } } },
      data: { revokedAt: new Date() },
    });
  }

  // ───────────────────────────── Panel (por organización y sitio) ─────────────────────────────

  private async siteOfOrganization(organizationId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true, name: true, organizationId: true } });
    if (!site) throw new NotFoundException(SITE_NOT_FOUND);
    return site;
  }

  private toResponse(member: { id: string; email: string; name: string | null; status: SiteMemberStatus; lastAccessAt: Date | null; createdAt: Date }): SiteMemberResponse {
    return {
      id: member.id,
      email: member.email,
      name: member.name,
      status: member.status,
      lastAccessAt: member.lastAccessAt?.toISOString() ?? null,
      createdAt: member.createdAt.toISOString(),
    };
  }

  async list(organizationId: string, siteId: string, query: ListMembersQueryDto): Promise<SiteMemberListResponse> {
    await this.siteOfOrganization(organizationId, siteId);
    const where: Prisma.SiteMemberWhereInput = { siteId, organizationId };
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [{ email: { contains: query.search, mode: "insensitive" } }, { name: { contains: query.search, mode: "insensitive" } }];
    }
    const [total, rows] = await Promise.all([
      this.prisma.siteMember.count({ where }),
      this.prisma.siteMember.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    return { items: rows.map((row) => this.toResponse(row)), total, page: query.page, pageSize: query.pageSize };
  }

  async add(organizationId: string, siteId: string, actorId: string, dto: AddMemberDto): Promise<SiteMemberResponse> {
    const site = await this.siteOfOrganization(organizationId, siteId);
    const existing = await this.prisma.siteMember.findUnique({ where: { siteId_email: { siteId, email: dto.email } } });
    if (existing?.status === SiteMemberStatus.ACTIVE) throw new ConflictException("Esa persona ya es miembro de este sitio.");
    if (!existing && (await this.prisma.siteMember.count({ where: { siteId } })) >= MEMBERS_PER_SITE_MAX) {
      throw new ConflictException(`Un sitio admite hasta ${MEMBERS_PER_SITE_MAX} miembros.`);
    }

    let member;
    try {
      member = existing
        ? await this.prisma.siteMember.update({ where: { id: existing.id }, data: { status: SiteMemberStatus.ACTIVE, name: dto.name ?? existing.name } })
        : await this.prisma.siteMember.create({ data: { organizationId, siteId, email: dto.email, name: dto.name ?? null } });
    } catch (error) {
      // Dos altas simultáneas del mismo correo: la segunda choca con el único (sitio, correo).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Esa persona ya es miembro de este sitio.");
      }
      throw error;
    }

    await this.audit.record({ organizationId, actorId, action: "member.added", targetType: "SiteMember", targetId: member.id, metadata: { siteId, reactivated: Boolean(existing) } });
    if (dto.sendAccess) {
      void this.sendAccessLink(site, member.id, member.email).catch((error) => logger.error("no se pudo enviar el acceso al nuevo miembro", { siteId, error }));
    }
    return this.toResponse(member);
  }

  private async memberOrThrow(organizationId: string, siteId: string, memberId: string) {
    const member = await this.prisma.siteMember.findFirst({ where: { id: memberId, siteId, organizationId } });
    if (!member) throw new NotFoundException("Miembro no encontrado.");
    return member;
  }

  /** Cortar a un miembro: pierde el acceso en el acto (sesiones revocadas, enlaces pendientes inutilizados). */
  async revoke(organizationId: string, siteId: string, memberId: string, actorId: string): Promise<SiteMemberResponse> {
    await this.memberOrThrow(organizationId, siteId, memberId);
    const now = new Date();
    const [member] = await this.prisma.$transaction([
      this.prisma.siteMember.update({ where: { id: memberId }, data: { status: SiteMemberStatus.REVOKED } }),
      this.prisma.siteMemberSession.updateMany({ where: { memberId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.siteMemberLoginToken.updateMany({ where: { memberId, usedAt: null }, data: { usedAt: now } }),
    ]);
    await this.audit.record({ organizationId, actorId, action: "member.revoked", targetType: "SiteMember", targetId: memberId, metadata: { siteId } });
    return this.toResponse(member);
  }

  async restore(organizationId: string, siteId: string, memberId: string, actorId: string): Promise<SiteMemberResponse> {
    await this.memberOrThrow(organizationId, siteId, memberId);
    const member = await this.prisma.siteMember.update({ where: { id: memberId }, data: { status: SiteMemberStatus.ACTIVE } });
    await this.audit.record({ organizationId, actorId, action: "member.restored", targetType: "SiteMember", targetId: memberId, metadata: { siteId } });
    return this.toResponse(member);
  }

  /** Quita a la persona y sus datos (derecho de supresión): el correo no queda en la auditoría, solo el id. */
  async remove(organizationId: string, siteId: string, memberId: string, actorId: string): Promise<void> {
    await this.memberOrThrow(organizationId, siteId, memberId);
    await this.prisma.siteMember.delete({ where: { id: memberId } });
    await this.audit.record({ organizationId, actorId, action: "member.removed", targetType: "SiteMember", targetId: memberId, metadata: { siteId } });
  }

  async settings(organizationId: string, siteId: string): Promise<MemberSettingsResponse> {
    await this.siteOfOrganization(organizationId, siteId);
    const [pages, memberCount] = await Promise.all([
      this.prisma.page.findMany({
        where: { siteId, deletedAt: null },
        orderBy: { position: "asc" },
        select: { id: true, slug: true, isHome: true, membersOnly: true, _count: { select: { versions: true } } },
      }),
      this.prisma.siteMember.count({ where: { siteId, status: SiteMemberStatus.ACTIVE } }),
    ]);
    return {
      pages: pages.map((page) => ({ id: page.id, slug: page.slug, isHome: page.isHome, membersOnly: page.membersOnly, published: page._count.versions > 0 })),
      memberCount,
    };
  }

  /** Activar o quitar «solo miembros». En vivo: se invalida la caché pública para que surta efecto al instante. */
  async setPageMembersOnly(organizationId: string, siteId: string, pageId: string, enabled: boolean, actorId: string): Promise<MemberSettingsResponse> {
    await this.siteOfOrganization(organizationId, siteId);
    const page = await this.prisma.page.findFirst({ where: { id: pageId, siteId, deletedAt: null }, select: { id: true } });
    if (!page) throw new NotFoundException("Página no encontrada.");
    await this.prisma.page.update({ where: { id: pageId }, data: { membersOnly: enabled } });
    await this.audit.record({ organizationId, actorId, action: "page.members_only_changed", targetType: "Page", targetId: pageId, metadata: { siteId, enabled } });
    await this.revalidateWeb.revalidateSite(siteId);
    return this.settings(organizationId, siteId);
  }
}
