import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AdminAbuseReportDetailResponse, AdminAbuseReportListResponse, AdminAbuseReportResponse } from "@impulza/contracts";
import { AbuseReportStatus, OrganizationStatus, Prisma, type PrismaClient } from "@impulza/database";
import {
  QUEUE_STATUSES,
  availableModerationActions,
  effectiveStatus,
  moderationTransition,
  type AbuseReportStatusValue,
  type ListAbuseReportsQueryDto,
  type ModerationAction,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AdminService } from "../admin/admin.service.js";
import { AuditService } from "../audit/audit.service.js";
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";
import { ModerationNotifier } from "./moderation-notifier.js";

const REPORT_NOT_FOUND = "Reporte no encontrado.";
const VIEWED_ACTION = "admin.abuse_report_viewed";

const REPORT_INCLUDE = {
  site: { select: { id: true, name: true, slug: true, moderationHiddenAt: true } },
  organization: { select: { id: true, name: true, status: true } },
} satisfies Prisma.AbuseReportInclude;
type ReportRow = Prisma.AbuseReportGetPayload<{ include: typeof REPORT_INCLUDE }>;

/**
 * Cola de moderación de superadministración (F9.9b, ADR-028 §7). Cada decisión lleva motivo, queda auditada con el
 * actor real y es reversible; nada se borra. Las transiciones válidas viven en `moderationTransition` (una tabla pura y
 * probada aparte): acá solo se aplican, con una actualización condicional para que dos personas del equipo no pisen la
 * misma decisión.
 */
@Injectable()
export class ModerationAdminService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(AdminService) private readonly adminService: AdminService,
    @Inject(RevalidateWebService) private readonly revalidateWeb: RevalidateWebService,
    @Inject(ModerationNotifier) private readonly notifier: ModerationNotifier,
  ) {}

  private toResponse(row: ReportRow, siteOpenReports: number): AdminAbuseReportResponse {
    return {
      id: row.id,
      reason: row.reason,
      details: row.details,
      reporterEmail: row.reporterEmail,
      status: row.status,
      resolution: row.resolution,
      appealText: row.appealText,
      appealedAt: row.appealedAt?.toISOString() ?? null,
      appealedFrom: row.statusBeforeAppeal,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      site: { id: row.site.id, name: row.site.name, slug: row.site.slug, hidden: row.site.moderationHiddenAt !== null },
      organization: { id: row.organization.id, name: row.organization.name, blocked: row.organization.status === OrganizationStatus.BLOCKED },
      siteOpenReports,
      availableActions: availableModerationActions(row.status, row.statusBeforeAppeal),
    };
  }

  private async openCountsBySite(siteIds: string[]): Promise<Map<string, number>> {
    if (siteIds.length === 0) return new Map();
    const groups = await this.prisma.abuseReport.groupBy({
      by: ["siteId"],
      where: { siteId: { in: siteIds }, status: { in: [...QUEUE_STATUSES] } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.siteId, group._count._all]));
  }

  async list(query: ListAbuseReportsQueryDto): Promise<AdminAbuseReportListResponse> {
    const conditions: Prisma.Sql[] = [];
    if (query.status === "QUEUE") {
      conditions.push(Prisma.sql`r.status IN ('OPEN'::"AbuseReportStatus", 'APPEALED'::"AbuseReportStatus")`);
    } else if (query.status !== "ALL") {
      conditions.push(Prisma.sql`r.status = ${query.status}::"AbuseReportStatus"`);
    }
    if (query.reason) conditions.push(Prisma.sql`r.reason = ${query.reason}::"AbuseReportReason"`);
    if (query.siteId) conditions.push(Prisma.sql`r.site_id = ${query.siteId}::uuid`);
    if (query.organizationId) conditions.push(Prisma.sql`r.organization_id = ${query.organizationId}::uuid`);
    const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

    const order =
      query.sort === "oldest"
        ? Prisma.sql`r.created_at ASC, r.id ASC`
        : query.sort === "newest"
          ? Prisma.sql`r.created_at DESC, r.id ASC`
          : Prisma.sql`COALESCE(k.open_count, 0) DESC, r.created_at ASC, r.id ASC`;
    const offset = (query.page - 1) * query.pageSize;

    const [ids, totalRows, queueSize] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT r.id::text AS id
        FROM abuse_reports r
        LEFT JOIN (
          SELECT site_id, COUNT(*)::int AS open_count FROM abuse_reports
          WHERE status IN ('OPEN'::"AbuseReportStatus", 'APPEALED'::"AbuseReportStatus") GROUP BY site_id
        ) k ON k.site_id = r.site_id
        ${where}
        ORDER BY ${order}
        LIMIT ${query.pageSize} OFFSET ${offset}`),
      this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`SELECT COUNT(*)::int AS total FROM abuse_reports r ${where}`),
      this.prisma.abuseReport.count({ where: { status: { in: [...QUEUE_STATUSES] } } }),
    ]);

    const rows = await this.prisma.abuseReport.findMany({ where: { id: { in: ids.map((row) => row.id) } }, include: REPORT_INCLUDE });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const counts = await this.openCountsBySite([...new Set(rows.map((row) => row.siteId))]);

    return {
      items: ids.flatMap(({ id }) => {
        const row = byId.get(id);
        return row ? [this.toResponse(row, counts.get(row.siteId) ?? 0)] : [];
      }),
      total: totalRows[0]?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
      queueSize,
    };
  }

  private async getRowOrThrow(reportId: string): Promise<ReportRow> {
    const row = await this.prisma.abuseReport.findUnique({ where: { id: reportId }, include: REPORT_INCLUDE });
    if (!row) throw new NotFoundException(REPORT_NOT_FOUND);
    return row;
  }

  private async buildDetail(reportId: string): Promise<AdminAbuseReportDetailResponse> {
    const row = await this.getRowOrThrow(reportId);
    const [counts, history] = await Promise.all([
      this.openCountsBySite([row.siteId]),
      this.prisma.auditLog.findMany({
        where: { targetType: "AbuseReport", targetId: reportId, action: { not: VIEWED_ACTION } },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { actor: { select: { email: true } } },
      }),
    ]);
    return {
      ...this.toResponse(row, counts.get(row.siteId) ?? 0),
      history: history.map((entry) => {
        const metadata = entry.metadata as { reason?: unknown } | null;
        return {
          id: entry.id,
          action: entry.action,
          actorEmail: entry.actor?.email ?? null,
          reason: typeof metadata?.reason === "string" ? metadata.reason : null,
          createdAt: entry.createdAt.toISOString(),
        };
      }),
    };
  }

  /** Abrir un reporte muestra el correo del denunciante: queda auditado, igual que el detalle de una organización. */
  async get(adminId: string, reportId: string): Promise<AdminAbuseReportDetailResponse> {
    const detail = await this.buildDetail(reportId);
    await this.auditService.record({
      organizationId: detail.organization.id,
      actorId: adminId,
      action: VIEWED_ACTION,
      targetType: "AbuseReport",
      targetId: reportId,
    });
    return detail;
  }

  async apply(adminId: string, reportId: string, action: ModerationAction, reason: string): Promise<AdminAbuseReportDetailResponse> {
    const report = await this.getRowOrThrow(reportId);
    const next = moderationTransition(report.status, action, report.statusBeforeAppeal);
    if (!next) {
      throw new ConflictException("Esta acción no corresponde al estado actual del reporte.");
    }

    // 1) Se RECLAMA la decisión con una actualización condicional sobre el estado exacto que se leyó: si otra persona del
    //    equipo decidió mientras tanto, esta no la pisa y, sobre todo, no llega a aplicar ningún efecto sobre el sitio.
    const claimed = await this.prisma.abuseReport.updateMany({
      where: { id: reportId, status: report.status },
      // Al decidir una apelación el caso deja de estar «apelado»: el estado previo ya cumplió su función.
      data: { status: next, resolution: reason, resolvedById: adminId, resolvedAt: new Date(), statusBeforeAppeal: null },
    });
    if (claimed.count === 0) {
      throw new ConflictException("Otra persona del equipo ya resolvió este reporte. Revisa su estado actual.");
    }

    // 2) El efecto (ocultar el sitio, bloquear o restaurar). Si falla, se deshace la reclamación: el caso nunca queda
    //    marcado con una medida que no se aplicó.
    try {
      await this.applySideEffect(adminId, report, effectiveStatus(report.status, report.statusBeforeAppeal), action, reason);
    } catch (error) {
      await this.prisma.abuseReport.updateMany({
        where: { id: reportId, status: next },
        data: {
          status: report.status,
          statusBeforeAppeal: report.statusBeforeAppeal,
          resolution: report.resolution,
          resolvedById: report.resolvedById,
          resolvedAt: report.resolvedAt,
        },
      });
      throw error;
    }

    await this.auditService.record({
      organizationId: report.organizationId,
      actorId: adminId,
      action: `admin.abuse_report_${action}`,
      targetType: "AbuseReport",
      targetId: reportId,
      metadata: { reason, siteId: report.siteId, from: report.status, to: next },
    });
    logger.warn("decisión de moderación aplicada", { reportId, action, from: report.status, to: next, adminId });

    await this.notifier.decision(
      { id: report.id, organizationId: report.organizationId, organizationName: report.organization.name, siteName: report.site.name, reason: report.reason },
      action,
      reason,
    );

    return this.buildDetail(reportId);
  }

  private async applySideEffect(adminId: string, report: ReportRow, current: AbuseReportStatusValue, action: ModerationAction, reason: string): Promise<void> {
    if (action === "unpublish") {
      await this.prisma.site.update({ where: { id: report.siteId }, data: { moderationHiddenAt: report.site.moderationHiddenAt ?? new Date() } });
      await this.revalidateWeb.revalidateSite(report.siteId);
      return;
    }

    if (action === "suspend") {
      if (report.organization.status === OrganizationStatus.BLOCKED) {
        throw new ConflictException("La organización ya está bloqueada.");
      }
      await this.adminService.blockOrganization(adminId, report.organizationId, `Moderación (reporte ${report.id}): ${reason}`);
      return;
    }

    if (action !== "restore") return; // `warn`, `dismiss` y `uphold` no tocan el sitio ni la organización.

    // Se deshace solo lo que ESTE caso aplicó, y solo si ningún otro reporte vigente lo sigue necesitando.
    if (current === AbuseReportStatus.ORG_SUSPENDED && report.organization.status === OrganizationStatus.BLOCKED) {
      const others = await this.prisma.abuseReport.count({
        where: { organizationId: report.organizationId, id: { not: report.id }, status: AbuseReportStatus.ORG_SUSPENDED },
      });
      if (others === 0) {
        await this.adminService.unblockOrganization(adminId, report.organizationId, `Moderación (reporte ${report.id}): ${reason}`);
      }
    }
    if (current === AbuseReportStatus.SITE_UNPUBLISHED || current === AbuseReportStatus.ORG_SUSPENDED) {
      const others = await this.prisma.abuseReport.count({
        where: { siteId: report.siteId, id: { not: report.id }, status: AbuseReportStatus.SITE_UNPUBLISHED },
      });
      if (others === 0 && report.site.moderationHiddenAt) {
        await this.prisma.site.update({ where: { id: report.siteId }, data: { moderationHiddenAt: null } });
        await this.revalidateWeb.revalidateSite(report.siteId);
      }
    }
  }
}
