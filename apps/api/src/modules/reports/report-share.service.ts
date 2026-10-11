import { createHash, randomBytes } from "node:crypto";
import { ConflictException, GoneException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CreatedReportShareLinkResponse, PublicReportResponse, ReportShareLinkResponse } from "@impulza/contracts";
import { OrganizationStatus, type PrismaClient, type ReportShareLink } from "@impulza/database";
import { REPORT_SHARE_TOKEN_PATTERN, type CreateReportShareDto } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { BrandProfileService } from "../brand-profile/brand-profile.service.js";
import { PlanLimitExceededException } from "../plans/plan-limit.exception.js";
import { ReportsService } from "./reports.service.js";

const DAY_MS = 86_400_000;
/** Enlaces vigentes por organización: un informe no necesita decenas de enlaces abiertos a la vez. */
export const MAX_ACTIVE_SHARE_LINKS = 20;

export const hashShareToken = (token: string): string => createHash("sha256").update(token).digest("hex");

function toResponse(row: ReportShareLink, now = new Date()): ReportShareLinkResponse {
  return {
    id: row.id,
    label: row.label,
    period: { from: row.periodFrom, to: row.periodTo },
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    active: row.revokedAt === null && row.expiresAt.getTime() > now.getTime(),
    createdAt: row.createdAt.toISOString(),
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    accessCount: row.accessCount,
  };
}

/**
 * Enlace compartido de solo lectura de un informe (F9.8b, ADR-028 §6). Garantías que se aplican aquí:
 * - el token son 256 bits aleatorios y **nunca se guarda**: solo su SHA-256; se muestra una única vez al crearlo;
 * - vence siempre (hasta 90 días) y se puede revocar; vencido o revocado responde 410, uno desconocido o mal formado 404;
 * - sirve solo cifras agregadas de la organización dueña y solo el periodo fijado al crearlo: ningún dato personal de contactos;
 * - una organización bloqueada o con el sitio oculto por su agencia deja de servir sus enlaces;
 * - el token no se registra (la ruta lo redacta en logs) y toda gestión queda en la auditoría sin él.
 */
@Injectable()
export class ReportShareService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly reports: ReportsService,
    private readonly auditService: AuditService,
    private readonly brandProfileService: BrandProfileService,
  ) {}

  async create(organizationId: string, actorId: string, dto: CreateReportShareDto): Promise<CreatedReportShareLinkResponse> {
    // El periodo del enlace obedece al historial del plan igual que el informe en pantalla (402).
    await this.reports.assertPeriodAllowed(organizationId, dto.from);

    const now = new Date();
    const active = await this.prisma.reportShareLink.count({ where: { organizationId, revokedAt: null, expiresAt: { gt: now } } });
    if (active >= MAX_ACTIVE_SHARE_LINKS) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: "SHARE_LINK_LIMIT",
        message: `Hay ${MAX_ACTIVE_SHARE_LINKS} enlaces vigentes: revoca alguno antes de crear otro.`,
      });
    }

    const token = randomBytes(32).toString("base64url");
    const row = await this.prisma.reportShareLink.create({
      data: {
        organizationId,
        tokenHash: hashShareToken(token),
        label: dto.label,
        periodFrom: dto.from,
        periodTo: dto.to,
        expiresAt: new Date(now.getTime() + dto.expiresInDays * DAY_MS),
        createdById: actorId,
      },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "report.share_created",
      targetType: "ReportShareLink",
      targetId: row.id,
      // Nunca el token ni su hash.
      metadata: { from: dto.from, to: dto.to, expiresAt: row.expiresAt.toISOString(), label: dto.label },
    });
    return { ...toResponse(row, now), token };
  }

  async list(organizationId: string): Promise<ReportShareLinkResponse[]> {
    const now = new Date();
    const rows = await this.prisma.reportShareLink.findMany({ where: { organizationId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100 });
    return rows.map((row) => toResponse(row, now));
  }

  async revoke(organizationId: string, actorId: string, linkId: string): Promise<ReportShareLinkResponse> {
    // Filtrado por organización: el enlace de otra organización es un 404 (ADR-002).
    const existing = await this.prisma.reportShareLink.findFirst({ where: { id: linkId, organizationId } });
    if (!existing) throw new NotFoundException("Enlace no encontrado.");
    if (existing.revokedAt !== null) return toResponse(existing);
    const row = await this.prisma.reportShareLink.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "report.share_revoked",
      targetType: "ReportShareLink",
      targetId: row.id,
      metadata: { from: row.periodFrom, to: row.periodTo },
    });
    return toResponse(row);
  }

  /** Un enlace servible o su error: 404 desconocido, 410 revocado o vencido. */
  private async find(token: string): Promise<ReportShareLink> {
    // Una forma que no es la de un token ni se consulta.
    if (!REPORT_SHARE_TOKEN_PATTERN.test(token)) throw new NotFoundException("Enlace no encontrado.");
    const link = await this.prisma.reportShareLink.findUnique({ where: { tokenHash: hashShareToken(token) } });
    if (!link) throw new NotFoundException("Enlace no encontrado.");
    if (link.revokedAt !== null) {
      throw new GoneException({ statusCode: 410, error: "Gone", code: "LINK_REVOKED", message: "Este enlace fue revocado." });
    }
    if (link.expiresAt.getTime() <= Date.now()) {
      throw new GoneException({ statusCode: 410, error: "Gone", code: "LINK_EXPIRED", message: "Este enlace venció." });
    }
    return link;
  }

  /** La organización dueña debe seguir sirviendo contenido público (no bloqueada, sitio no oculto por su agencia). */
  private async assertServable(organizationId: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { status: true, publicHiddenAt: true } });
    if (!organization || organization.status !== OrganizationStatus.ACTIVE || organization.publicHiddenAt !== null) {
      throw new NotFoundException("Enlace no encontrado.");
    }
  }

  async resolve(token: string): Promise<PublicReportResponse> {
    const link = await this.find(token);
    await this.assertServable(link.organizationId);
    let report;
    try {
      report = await this.reports.build(link.organizationId, { from: link.periodFrom, to: link.periodTo });
    } catch (error) {
      // El plan ya no cubre ese historial: no se sirve (y no se explica a quien tiene el enlace por qué).
      if (error instanceof PlanLimitExceededException) throw new NotFoundException("Enlace no encontrado.");
      throw error;
    }
    const brand = await this.brandProfileService.resolveBrand(link.organizationId, "customer");
    // El nombre que se muestra es el de la marca propia del negocio o, si no la configuró, el del propio negocio: nunca el de la plataforma.
    const own = await this.brandProfileService.getOwnBrand(link.organizationId);
    // Registro de uso: solo un contador y la última hora (nada de IP ni agente de usuario).
    await this.prisma.reportShareLink.update({ where: { id: link.id }, data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() } }).catch(() => undefined);
    return {
      report,
      brand: { displayName: own?.displayName ?? report.organizationName, logoLightUrl: brand.logoLightUrl, primaryColor: brand.primaryColor },
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  async resolveCsv(token: string): Promise<string> {
    const link = await this.find(token);
    await this.assertServable(link.organizationId);
    try {
      return await this.reports.buildCsv(link.organizationId, { from: link.periodFrom, to: link.periodTo });
    } catch (error) {
      if (error instanceof PlanLimitExceededException) throw new NotFoundException("Enlace no encontrado.");
      throw error;
    }
  }
}
