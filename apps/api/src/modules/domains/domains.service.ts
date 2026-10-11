import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { SiteDomainResponse } from "@impulza/contracts";
import type { PrismaClient, SiteDomain } from "@impulza/database";
import {
  domainVerificationRecord,
  isSameOrSubdomain,
  MAX_DOMAINS_PER_SITE,
  type CreateSiteDomainInput,
  type DomainCheckError,
} from "@impulza/validation";
import { ACTIVE_ORGANIZATION } from "../../common/active-organization.js";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { DOMAIN_DNS_RESOLVER, type DomainDnsResolver } from "./dns-resolver.js";

export const DOMAIN_NOT_FOUND = "Dominio no encontrado: no existe, o pertenece a otro sitio u organización (ADR-002).";
export const DOMAIN_TAKEN = "Ese dominio ya está verificado en otro sitio.";

/**
 * Dominios propios (F4.7).
 *
 * - **Propiedad por DNS**: el dominio queda verificado solo si su TXT `_impulza.<dominio>` trae el
 *   token de este reclamo, que solo quien controla el DNS puede publicar.
 * - **Sin toma de dominio**: varios reclamos pendientes pueden coexistir (ninguno bloquea al dueño
 *   real), pero un dominio queda verificado en un solo sitio: lo garantiza el índice único parcial
 *   `site_domains_one_verified_per_domain`, no una comprobación previa que una carrera podría saltar.
 * - **Sin SSRF**: solo consultas DNS a nombres públicos ya validados; nunca HTTP al dominio.
 * - La emisión de SSL depende del hosting (F4.8): `sslStatus` queda `PENDING` hasta entonces.
 */
@Injectable()
export class DomainsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    @Inject(DOMAIN_DNS_RESOLVER) private readonly dns: DomainDnsResolver,
  ) {}

  toResponse(domain: SiteDomain): SiteDomainResponse {
    return {
      id: domain.id,
      siteId: domain.siteId,
      domain: domain.domain,
      status: domain.verificationStatus,
      sslStatus: domain.sslStatus,
      verification: domainVerificationRecord(domain.domain, domain.verificationToken),
      cnameTarget: env.CUSTOM_DOMAIN_CNAME_TARGET ?? null,
      lastCheckError: (domain.lastCheckError as DomainCheckError | null) ?? null,
      lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
      verifiedAt: domain.verifiedAt?.toISOString() ?? null,
      createdAt: domain.createdAt.toISOString(),
    };
  }

  /** 404 y no 403 ante un id cruzado (ADR-002), como el resto de los recursos de un sitio. */
  private async assertSiteInOrganization(organizationId: string, siteId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true } });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
  }

  private async getOrThrow(organizationId: string, siteId: string, domainId: string): Promise<SiteDomain> {
    const domain = await this.prisma.siteDomain.findFirst({ where: { id: domainId, siteId, organizationId } });
    if (!domain) {
      throw new NotFoundException(DOMAIN_NOT_FOUND);
    }
    return domain;
  }

  async list(organizationId: string, siteId: string): Promise<SiteDomainResponse[]> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const domains = await this.prisma.siteDomain.findMany({ where: { siteId, organizationId }, orderBy: { createdAt: "asc" } });
    return domains.map((domain) => this.toResponse(domain));
  }

  async create(organizationId: string, actorId: string, siteId: string, input: CreateSiteDomainInput): Promise<SiteDomainResponse> {
    await this.assertSiteInOrganization(organizationId, siteId);
    const { domain } = input;

    if (env.PLATFORM_DOMAIN && isSameOrSubdomain(domain, env.PLATFORM_DOMAIN)) {
      throw new UnprocessableEntityException("Ese dominio es de la plataforma: usa uno propio.");
    }
    const verifiedElsewhere = await this.prisma.siteDomain.findFirst({
      where: { domain, verificationStatus: "VERIFIED", NOT: { siteId } },
      select: { id: true },
    });
    // F9.7d: tampoco si ya es el dominio verificado del portal de una agencia.
    const verifiedAsPortal = verifiedElsewhere ? null : await this.prisma.agencyDomain.findFirst({ where: { domain, verificationStatus: "VERIFIED" }, select: { id: true } });
    if (verifiedElsewhere || verifiedAsPortal) {
      throw new ConflictException(DOMAIN_TAKEN);
    }
    const count = await this.prisma.siteDomain.count({ where: { siteId } });
    if (count >= MAX_DOMAINS_PER_SITE) {
      throw new UnprocessableEntityException(`Un sitio admite hasta ${MAX_DOMAINS_PER_SITE} dominios.`);
    }

    let created: SiteDomain;
    try {
      created = await this.prisma.siteDomain.create({
        data: {
          organizationId,
          siteId,
          domain,
          type: "CUSTOM",
          verificationToken: randomBytes(16).toString("hex"),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Ese dominio ya está agregado a este sitio.");
      }
      throw error;
    }

    await this.auditService.record({
      organizationId,
      actorId,
      action: "domain.added",
      targetType: "SiteDomain",
      targetId: created.id,
      metadata: { siteId, domain },
    });
    logger.info("dominio propio agregado", { organizationId, siteId, domainId: created.id });
    return this.toResponse(created);
  }

  async verify(organizationId: string, actorId: string, siteId: string, domainId: string): Promise<SiteDomainResponse> {
    const domain = await this.getOrThrow(organizationId, siteId, domainId);
    if (domain.verificationStatus === "VERIFIED") {
      return this.toResponse(domain);
    }

    const record = domainVerificationRecord(domain.domain, domain.verificationToken);
    const lookup = await this.dns.lookupTxt(record.name);
    const checkError: DomainCheckError | null = !lookup.ok
      ? lookup.error
      : lookup.values.some((value) => value.trim() === record.value)
        ? null
        : "TXT_MISMATCH";
    const now = new Date();

    if (checkError) {
      const failed = await this.prisma.siteDomain.update({
        where: { id: domain.id },
        data: { verificationStatus: "FAILED", lastCheckedAt: now, lastCheckError: checkError },
      });
      logger.info("verificación de dominio sin éxito", { organizationId, siteId, domainId, checkError });
      return this.toResponse(failed);
    }

    let verified: SiteDomain;
    try {
      verified = await this.prisma.$transaction(async (tx) => {
        // F9.7d: la verificación de un dominio (de sitio o de portal) es de a una por nombre; así no pueden verificarse a la vez en los
        // dos lados (el índice parcial de cada tabla no ve la otra).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`domain:${domain.domain}`}, 0))`;
        if (await tx.agencyDomain.findFirst({ where: { domain: domain.domain, verificationStatus: "VERIFIED" }, select: { id: true } })) {
          throw new ConflictException(DOMAIN_TAKEN);
        }
        return tx.siteDomain.update({
          where: { id: domain.id },
          data: { verificationStatus: "VERIFIED", verifiedAt: now, lastCheckedAt: now, lastCheckError: null },
        });
      });
    } catch (error) {
      // Otro sitio lo verificó primero (el índice parcial rechaza el segundo).
      if (isUniqueViolation(error)) {
        throw new ConflictException(DOMAIN_TAKEN);
      }
      throw error;
    }

    await this.auditService.record({
      organizationId,
      actorId,
      action: "domain.verified",
      targetType: "SiteDomain",
      targetId: domain.id,
      metadata: { siteId, domain: domain.domain },
    });
    logger.info("dominio propio verificado", { organizationId, siteId, domainId });
    return this.toResponse(verified);
  }

  async remove(organizationId: string, actorId: string, siteId: string, domainId: string): Promise<void> {
    const domain = await this.getOrThrow(organizationId, siteId, domainId);
    await this.prisma.siteDomain.delete({ where: { id: domain.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "domain.removed",
      targetType: "SiteDomain",
      targetId: domain.id,
      metadata: { siteId, domain: domain.domain, wasVerified: domain.verificationStatus === "VERIFIED" },
    });
  }

  /**
   * Resolución pública (la usa el `proxy` de `apps/web`): solo un dominio verificado de un sitio no
   * archivado de una organización activa. Devuelve únicamente el slug; ningún id interno.
   */
  async resolvePublic(hostname: string): Promise<{ siteSlug: string } | null> {
    const domain = await this.prisma.siteDomain.findFirst({
      where: { domain: hostname, verificationStatus: "VERIFIED", site: { status: { not: "ARCHIVED" }, ...ACTIVE_ORGANIZATION } },
      select: { site: { select: { slug: true } } },
    });
    return domain ? { siteSlug: domain.site.slug } : null;
  }
}
