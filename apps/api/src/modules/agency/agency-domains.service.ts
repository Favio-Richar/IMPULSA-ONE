import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { AgencyPortalDomainResponse, PublicPortalResolution } from "@impulza/contracts";
import { OrganizationStatus, type AgencyDomain, type PrismaClient } from "@impulza/database";
import { domainVerificationRecord, isSameOrSubdomain, MAX_DOMAINS_PER_SITE, type CreateSiteDomainInput, type DomainCheckError } from "@impulza/validation";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { DOMAIN_DNS_RESOLVER, type DomainDnsResolver } from "../domains/dns-resolver.js";
import { AgencyService } from "./agency.service.js";

export const PORTAL_DOMAIN_NOT_FOUND = "Dominio no encontrado: no existe, o es de otra agencia (ADR-002).";
export const PORTAL_DOMAIN_TAKEN = "Ese dominio ya está verificado en otro sitio o agencia.";
/** Tope de dominios de portal por agencia: no hace falta más de uno o dos, y acota el trabajo de verificar. */
export const MAX_PORTAL_DOMAINS_PER_AGENCY = MAX_DOMAINS_PER_SITE;

/**
 * Dominio propio del portal de una agencia (F9.7d, ADR-028 §5). Mismas garantías que los dominios de un sitio (F4.7):
 * - **propiedad por DNS**: se verifica solo si el TXT `_impulza.<dominio>` trae el token de ESTE reclamo;
 * - **sin toma de dominio**: varios reclamos pendientes coexisten, pero un dominio queda verificado en un solo lugar (índice parcial
 *   propio y comprobación cruzada con los dominios de sitio, bajo un candado por nombre);
 * - **un dominio no verificado nunca sirve el portal**: la resolución pública solo responde para un dominio VERIFIED de una agencia
 *   activa con su marca configurada, y con el mismo 404 en cualquier otro caso (sin pistas);
 * - **sin SSRF**: solo consultas DNS a nombres públicos ya validados.
 */
@Injectable()
export class AgencyDomainsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly agencyService: AgencyService,
    @Inject(DOMAIN_DNS_RESOLVER) private readonly dns: DomainDnsResolver,
  ) {}

  toResponse(domain: AgencyDomain): AgencyPortalDomainResponse {
    return {
      id: domain.id,
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

  private async getOrThrow(agencyOrganizationId: string, domainId: string): Promise<AgencyDomain> {
    // Filtrado por agencia: el dominio de otra agencia es un 404 (ADR-002).
    const domain = await this.prisma.agencyDomain.findFirst({ where: { id: domainId, agencyOrganizationId } });
    if (!domain) throw new NotFoundException(PORTAL_DOMAIN_NOT_FOUND);
    return domain;
  }

  async list(agencyOrganizationId: string): Promise<AgencyPortalDomainResponse[]> {
    await this.agencyService.assertAgency(agencyOrganizationId);
    const domains = await this.prisma.agencyDomain.findMany({ where: { agencyOrganizationId }, orderBy: { createdAt: "asc" } });
    return domains.map((domain) => this.toResponse(domain));
  }

  async create(agencyOrganizationId: string, actorId: string, input: CreateSiteDomainInput): Promise<AgencyPortalDomainResponse> {
    await this.agencyService.assertAgency(agencyOrganizationId);
    const { domain } = input;

    if (env.PLATFORM_DOMAIN && isSameOrSubdomain(domain, env.PLATFORM_DOMAIN)) {
      throw new UnprocessableEntityException("Ese dominio es de la plataforma: usa uno propio.");
    }
    const [asSite, asPortal] = await Promise.all([
      this.prisma.siteDomain.findFirst({ where: { domain, verificationStatus: "VERIFIED" }, select: { id: true } }),
      this.prisma.agencyDomain.findFirst({ where: { domain, verificationStatus: "VERIFIED", NOT: { agencyOrganizationId } }, select: { id: true } }),
    ]);
    if (asSite || asPortal) throw new ConflictException(PORTAL_DOMAIN_TAKEN);
    if ((await this.prisma.agencyDomain.count({ where: { agencyOrganizationId } })) >= MAX_PORTAL_DOMAINS_PER_AGENCY) {
      throw new UnprocessableEntityException(`Una agencia admite hasta ${MAX_PORTAL_DOMAINS_PER_AGENCY} dominios de portal.`);
    }

    let created: AgencyDomain;
    try {
      created = await this.prisma.agencyDomain.create({ data: { agencyOrganizationId, domain, verificationToken: randomBytes(16).toString("hex") } });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("Ese dominio ya está agregado a tu agencia.");
      throw error;
    }
    await this.auditService.record({
      organizationId: agencyOrganizationId,
      actorId,
      action: "agency.portal_domain_added",
      targetType: "AgencyDomain",
      targetId: created.id,
      metadata: { domain },
    });
    logger.info("dominio de portal de agencia agregado", { agencyOrganizationId, domainId: created.id });
    return this.toResponse(created);
  }

  async verify(agencyOrganizationId: string, actorId: string, domainId: string): Promise<AgencyPortalDomainResponse> {
    const domain = await this.getOrThrow(agencyOrganizationId, domainId);
    if (domain.verificationStatus === "VERIFIED") return this.toResponse(domain);

    const record = domainVerificationRecord(domain.domain, domain.verificationToken);
    const lookup = await this.dns.lookupTxt(record.name);
    const checkError: DomainCheckError | null = !lookup.ok ? lookup.error : lookup.values.some((value) => value.trim() === record.value) ? null : "TXT_MISMATCH";
    const now = new Date();

    if (checkError) {
      const failed = await this.prisma.agencyDomain.update({
        where: { id: domain.id },
        data: { verificationStatus: "FAILED", lastCheckedAt: now, lastCheckError: checkError },
      });
      return this.toResponse(failed);
    }

    let verified: AgencyDomain;
    try {
      verified = await this.prisma.$transaction(async (tx) => {
        // La verificación de un nombre es de a una (de sitio o de portal): el candado cubre la comprobación cruzada y el cambio.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`domain:${domain.domain}`}, 0))`;
        if (await tx.siteDomain.findFirst({ where: { domain: domain.domain, verificationStatus: "VERIFIED" }, select: { id: true } })) {
          throw new ConflictException(PORTAL_DOMAIN_TAKEN);
        }
        return tx.agencyDomain.update({
          where: { id: domain.id },
          data: { verificationStatus: "VERIFIED", verifiedAt: now, lastCheckedAt: now, lastCheckError: null },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(PORTAL_DOMAIN_TAKEN);
      throw error;
    }
    await this.auditService.record({
      organizationId: agencyOrganizationId,
      actorId,
      action: "agency.portal_domain_verified",
      targetType: "AgencyDomain",
      targetId: domain.id,
      metadata: { domain: domain.domain },
    });
    return this.toResponse(verified);
  }

  async remove(agencyOrganizationId: string, actorId: string, domainId: string): Promise<void> {
    const domain = await this.getOrThrow(agencyOrganizationId, domainId);
    await this.prisma.agencyDomain.delete({ where: { id: domain.id } });
    await this.auditService.record({
      organizationId: agencyOrganizationId,
      actorId,
      action: "agency.portal_domain_removed",
      targetType: "AgencyDomain",
      targetId: domain.id,
      metadata: { domain: domain.domain, wasVerified: domain.verificationStatus === "VERIFIED" },
    });
  }

  /**
   * Resolución pública del portal: solo un dominio VERIFIED de una agencia activa (no bloqueada) que tenga su marca configurada. Devuelve
   * solo la marca pública; ningún id ni dato de clientes. Un dominio pendiente o fallido **nunca** resuelve.
   */
  async resolvePublic(hostname: string): Promise<PublicPortalResolution | null> {
    const domain = await this.prisma.agencyDomain.findFirst({
      where: {
        domain: hostname,
        verificationStatus: "VERIFIED",
        // Agencia no bloqueada y con su marca configurada (sin nombre de marca no hay portal que servir).
        agencyOrganization: { status: OrganizationStatus.ACTIVE, whiteLabel: { is: { displayName: { not: null } } } },
      },
      select: {
        agencyOrganization: {
          select: {
            whiteLabel: {
              select: { displayName: true, logoLightUrl: true, logoDarkUrl: true, faviconUrl: true, primaryColor: true, secondaryColor: true, supportEmail: true, footerText: true },
            },
          },
        },
      },
    });
    const brand = domain?.agencyOrganization.whiteLabel;
    if (!brand?.displayName) return null;
    return {
      brand: {
        displayName: brand.displayName,
        logoLightUrl: brand.logoLightUrl,
        logoDarkUrl: brand.logoDarkUrl,
        faviconUrl: brand.faviconUrl,
        // Los colores de marca van validados al guardar; el valor por defecto cubre una marca sin color configurado.
        primaryColor: brand.primaryColor ?? "#0f6f6b",
        secondaryColor: brand.secondaryColor ?? "#0b5450",
        supportEmail: brand.supportEmail,
        footerText: brand.footerText,
      },
    };
  }
}
