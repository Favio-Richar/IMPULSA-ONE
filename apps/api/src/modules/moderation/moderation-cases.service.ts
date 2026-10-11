import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ModerationCaseResponse } from "@impulza/contracts";
import { AbuseReportStatus, type Prisma, type PrismaClient } from "@impulza/database";
import { canAppeal, isMeasure, MEASURE_STATUSES, type MeasureStatus } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { ModerationNotifier } from "./moderation-notifier.js";

const CASE_NOT_FOUND = "Caso no encontrado.";

const CASE_INCLUDE = {
  site: { select: { id: true, name: true } },
  organization: { select: { name: true } },
} satisfies Prisma.AbuseReportInclude;
type CaseRow = Prisma.AbuseReportGetPayload<{ include: typeof CASE_INCLUDE }>;

/**
 * Medidas de moderación vistas por el propietario y su apelación (F9.9c, ADR-028 §7). Todo se resuelve por
 * `organizationId` en la consulta: un caso de otra organización responde 404, igual que uno inexistente.
 */
@Injectable()
export class ModerationCasesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(ModerationNotifier) private readonly notifier: ModerationNotifier,
  ) {}

  private toResponse(row: CaseRow): ModerationCaseResponse {
    const measure: MeasureStatus | null = isMeasure(row.status)
      ? row.status
      : row.status === AbuseReportStatus.APPEALED && isMeasure(row.statusBeforeAppeal)
        ? row.statusBeforeAppeal
        : null;
    return {
      id: row.id,
      reason: row.reason,
      status: row.status,
      measure,
      statement: row.resolution,
      site: { id: row.site.id, name: row.site.name },
      decidedAt: row.resolvedAt?.toISOString() ?? null,
      canAppeal: canAppeal(row.status, row.appealedAt),
      appealText: row.appealText,
      appealedAt: row.appealedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Solo lo que afecta al negocio: medidas vigentes, apelaciones y apelaciones ya resueltas. Reportes abiertos o descartados sin apelación no aparecen. */
  async list(organizationId: string): Promise<ModerationCaseResponse[]> {
    const rows = await this.prisma.abuseReport.findMany({
      where: {
        organizationId,
        OR: [{ status: { in: [...MEASURE_STATUSES, AbuseReportStatus.APPEALED] } }, { status: AbuseReportStatus.DISMISSED, appealedAt: { not: null } }],
      },
      orderBy: [{ resolvedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: CASE_INCLUDE,
    });
    return rows.map((row) => this.toResponse(row));
  }

  async appeal(organizationId: string, caseId: string, userId: string, text: string): Promise<ModerationCaseResponse> {
    const row = await this.prisma.abuseReport.findFirst({ where: { id: caseId, organizationId }, include: CASE_INCLUDE });
    if (!row) throw new NotFoundException(CASE_NOT_FOUND);
    if (!canAppeal(row.status, row.appealedAt)) {
      throw new ConflictException(row.appealedAt ? "Ya apelaste esta decisión: el equipo la está revisando o ya la revisó." : "Este caso no tiene una medida que se pueda apelar.");
    }

    // Reclamación condicional: dos envíos simultáneos no generan dos apelaciones. La medida sigue vigente mientras se revisa.
    const claimed = await this.prisma.abuseReport.updateMany({
      where: { id: caseId, organizationId, status: row.status, appealedAt: null },
      data: {
        status: AbuseReportStatus.APPEALED,
        statusBeforeAppeal: row.status,
        appealText: text,
        appealedAt: new Date(),
        appealedById: userId,
      },
    });
    if (claimed.count === 0) {
      throw new ConflictException("Este caso cambió mientras apelabas. Revisa su estado actual.");
    }

    await this.auditService.record({
      organizationId,
      actorId: userId,
      action: "moderation.appealed",
      targetType: "AbuseReport",
      targetId: caseId,
      metadata: { siteId: row.siteId, measure: row.status },
    });
    logger.info("apelacion de moderacion recibida", { caseId, organizationId });

    await this.notifier.appealReceived({
      id: row.id,
      organizationId,
      organizationName: row.organization.name,
      siteName: row.site.name,
      reason: row.reason,
    });

    const updated = await this.prisma.abuseReport.findUniqueOrThrow({ where: { id: caseId }, include: CASE_INCLUDE });
    return this.toResponse(updated);
  }
}
