import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import type { ReportResponse, ReportRunResponse, ReportScheduleResponse } from "@impulza/contracts";
import { OrganizationStatus, Prisma, ReportRunStatus, type PrismaClient, type ReportRun, type ReportSchedule } from "@impulza/database";
import {
  REPORT_SCHEDULES_PER_ORGANIZATION_MAX,
  latestOccurrence,
  nextScheduledRun,
  scheduledPeriod,
  type CreateReportScheduleDto,
  type UpdateReportScheduleDto,
} from "@impulza/validation";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { BrandProfileService } from "../brand-profile/brand-profile.service.js";
import { PlanLimitExceededException } from "../plans/plan-limit.exception.js";
import { hashShareToken } from "./report-share.service.js";
import { ReportsService } from "./reports.service.js";

const DAY_MS = 86_400_000;
/** Intentos de envío por ejecución; al agotarse queda FAILED y se ve en el registro. */
export const REPORT_RUN_MAX_ATTEMPTS = 3;
/** El enlace del correo vence a los 14 días: da margen para abrirlo sin dejar un acceso abierto indefinidamente. */
const EMAIL_LINK_DAYS = 14;
/** Una ejecución PENDING sin avanzar más de este tiempo se vuelve a encolar (la cola perdió el trabajo o un proceso murió). */
const STALLED_AFTER_MS = 5 * 60_000;
const DUE_BATCH = 100;

function scheduleResponse(row: ReportSchedule): ReportScheduleResponse {
  return {
    id: row.id,
    frequency: row.frequency,
    recipients: row.recipients,
    label: row.label,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function runResponse(row: ReportRun): ReportRunResponse {
  return {
    id: row.id,
    scheduleId: row.scheduleId,
    period: { from: row.periodFrom, to: row.periodTo },
    scheduledFor: row.scheduledFor.toISOString(),
    status: row.status,
    attempts: row.attempts,
    errorCode: row.errorCode,
    deliveredCount: row.deliveredTo.length,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const number = new Intl.NumberFormat("es-CL");

function metricLine(metric: ReportResponse["metrics"][number], report: ReportResponse): string {
  const value =
    metric.key === "revenue" && report.currency
      ? new Intl.NumberFormat("es-CL", { style: "currency", currency: report.currency, maximumFractionDigits: 0 }).format(metric.value)
      : number.format(metric.value);
  const change = metric.previous.change;
  const vs =
    report.comparison.previousAvailable && change !== null && metric.previous.base !== null
      ? ` (${change > 0 ? "+" : ""}${number.format(change)} vs. periodo anterior)`
      : "";
  return `- ${metric.label}: ${value}${vs}`;
}

/** El texto del correo: cifras agregadas del periodo y, si hay URL pública del sitio, el enlace al informe completo. */
export function buildReportEmailText(report: ReportResponse, label: string | null, link: string | null): string {
  const lines = [
    label ? `${label}` : "Informe periódico",
    `${report.organizationName} · del ${report.period.from} al ${report.period.to}`,
    "",
    ...report.metrics.map((metric) => metricLine(metric, report)),
  ];
  if (link) lines.push("", `Ver el informe completo (el enlace vence en ${EMAIL_LINK_DAYS} días): ${link}`);
  return lines.join("\n");
}

/**
 * Informes programados (F9.8c, ADR-028 §6). Garantías:
 * - **idempotente por periodo**: `(scheduleId, periodFrom)` es único; dos procesos, un reintento o un tick repetido producen una sola
 *   ejecución, y el avance de `nextRunAt` se reclama con un `updateMany` condicionado al valor leído;
 * - **registro de cada ejecución** (PENDING → SENT | FAILED) con intentos y un código de error sin datos internos;
 * - **sin duplicar correos en un reintento**: `deliveredTo` recuerda a quién ya llegó;
 * - el periodo depende de la fecha programada, no de cuándo se procesó, y un atraso largo salta a la ocurrencia más reciente;
 * - el correo lleva la marca resuelta del negocio (F9.2/F9.7) y solo cifras agregadas.
 */
@Injectable()
export class ReportScheduleService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly reports: ReportsService,
    private readonly auditService: AuditService,
    private readonly brandProfileService: BrandProfileService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
  ) {}

  // ---- gestión ------------------------------------------------------------------------------------------------------------

  async list(organizationId: string): Promise<ReportScheduleResponse[]> {
    const rows = await this.prisma.reportSchedule.findMany({ where: { organizationId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    return rows.map(scheduleResponse);
  }

  async create(organizationId: string, actorId: string, dto: CreateReportScheduleDto): Promise<ReportScheduleResponse> {
    const count = await this.prisma.reportSchedule.count({ where: { organizationId } });
    if (count >= REPORT_SCHEDULES_PER_ORGANIZATION_MAX) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: "SCHEDULE_LIMIT",
        message: `Ya hay ${REPORT_SCHEDULES_PER_ORGANIZATION_MAX} informes programados: elimina alguno antes de crear otro.`,
      });
    }
    const row = await this.prisma.reportSchedule.create({
      data: {
        organizationId,
        frequency: dto.frequency,
        recipients: dto.recipients,
        label: dto.label,
        // Estrictamente futura: crear una programación nunca dispara un envío inmediato.
        nextRunAt: nextScheduledRun(dto.frequency, new Date()),
        createdById: actorId,
      },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "report.schedule_created",
      targetType: "ReportSchedule",
      targetId: row.id,
      metadata: { frequency: row.frequency, recipientCount: row.recipients.length },
    });
    return scheduleResponse(row);
  }

  async update(organizationId: string, actorId: string, scheduleId: string, dto: UpdateReportScheduleDto): Promise<ReportScheduleResponse> {
    // Filtrado por organización: la programación de otra organización es un 404 (ADR-002).
    const existing = await this.prisma.reportSchedule.findFirst({ where: { id: scheduleId, organizationId } });
    if (!existing) throw new NotFoundException("Programación no encontrada.");
    const data: Prisma.ReportScheduleUpdateInput = {};
    if (dto.recipients !== undefined) data.recipients = dto.recipients;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.enabled !== undefined) {
      data.enabled = dto.enabled;
      // Al reactivar no se envía lo que pasó mientras estuvo apagada: se retoma desde la próxima ocurrencia.
      if (dto.enabled && !existing.enabled) data.nextRunAt = nextScheduledRun(existing.frequency, new Date());
    }
    const row = await this.prisma.reportSchedule.update({ where: { id: existing.id }, data });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "report.schedule_updated",
      targetType: "ReportSchedule",
      targetId: row.id,
      metadata: { enabled: row.enabled, recipientCount: row.recipients.length },
    });
    return scheduleResponse(row);
  }

  async remove(organizationId: string, actorId: string, scheduleId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.reportSchedule.findFirst({ where: { id: scheduleId, organizationId } });
    if (!existing) throw new NotFoundException("Programación no encontrada.");
    await this.prisma.reportSchedule.delete({ where: { id: existing.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "report.schedule_deleted",
      targetType: "ReportSchedule",
      targetId: existing.id,
      metadata: { frequency: existing.frequency },
    });
    return { deleted: true };
  }

  async listRuns(organizationId: string): Promise<ReportRunResponse[]> {
    const rows = await this.prisma.reportRun.findMany({ where: { organizationId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 50 });
    return rows.map(runResponse);
  }

  // ---- ejecución ----------------------------------------------------------------------------------------------------------

  /**
   * Convierte en ejecuciones las programaciones vencidas y devuelve los ids a procesar (nuevos y los PENDING sin avanzar).
   * Reclamar es atómico: solo quien logra mover `nextRunAt` desde el valor que leyó crea la ejecución.
   */
  async runDue(now = new Date()): Promise<string[]> {
    const due = await this.prisma.reportSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, orderBy: { nextRunAt: "asc" }, take: DUE_BATCH });
    const runIds: string[] = [];
    for (const schedule of due) {
      const occurrence = latestOccurrence(schedule.frequency, schedule.nextRunAt, now);
      const period = scheduledPeriod(schedule.frequency, occurrence);
      const claimed = await this.prisma.$transaction(async (tx) => {
        const moved = await tx.reportSchedule.updateMany({
          where: { id: schedule.id, enabled: true, nextRunAt: schedule.nextRunAt },
          data: { nextRunAt: nextScheduledRun(schedule.frequency, occurrence), lastRunAt: occurrence },
        });
        if (moved.count === 0) return null;
        // La unicidad `(scheduleId, periodFrom)` es la defensa de fondo: un periodo no se envía dos veces aunque dos procesos coincidan
        // (`ON CONFLICT DO NOTHING`: el perdedor no falla ni aborta su transacción, simplemente no crea nada).
        const inserted = await tx.reportRun.createMany({
          data: [{ scheduleId: schedule.id, organizationId: schedule.organizationId, periodFrom: period.from, periodTo: period.to, scheduledFor: occurrence }],
          skipDuplicates: true,
        });
        if (inserted.count === 0) return null;
        return tx.reportRun.findUnique({ where: { scheduleId_periodFrom: { scheduleId: schedule.id, periodFrom: period.from } } });
      });
      if (claimed) runIds.push(claimed.id);
    }
    const stalled = await this.prisma.reportRun.findMany({
      where: { status: ReportRunStatus.PENDING, attempts: { lt: REPORT_RUN_MAX_ATTEMPTS }, createdAt: { lte: new Date(now.getTime() - STALLED_AFTER_MS) } },
      select: { id: true },
      take: DUE_BATCH,
    });
    for (const run of stalled) if (!runIds.includes(run.id)) runIds.push(run.id);
    return runIds;
  }

  /**
   * Procesa una ejecución. Devuelve su estado final; lanza solo ante un fallo reintentable (la cola reintenta con espera creciente).
   * Los fallos definitivos (plan, organización inactiva, programación apagada) quedan FAILED sin reintentar.
   */
  async processRun(runId: string): Promise<ReportRunStatus> {
    const run = await this.prisma.reportRun.findUnique({ where: { id: runId }, include: { schedule: true } });
    if (!run) return ReportRunStatus.FAILED;
    if (run.status !== ReportRunStatus.PENDING) return run.status;

    const fail = async (errorCode: string): Promise<ReportRunStatus> => {
      await this.prisma.reportRun.update({ where: { id: run.id }, data: { status: ReportRunStatus.FAILED, errorCode } });
      logger.warn("report.run.failed", { runId: run.id, errorCode });
      return ReportRunStatus.FAILED;
    };

    if (!run.schedule.enabled) return fail("SCHEDULE_DISABLED");
    const organization = await this.prisma.organization.findUnique({ where: { id: run.organizationId }, select: { status: true } });
    if (!organization || organization.status !== OrganizationStatus.ACTIVE) return fail("ORGANIZATION_INACTIVE");

    const attempted = await this.prisma.reportRun.update({ where: { id: run.id }, data: { attempts: { increment: 1 } }, select: { attempts: true } });

    let report: ReportResponse;
    try {
      report = await this.reports.build(run.organizationId, { from: run.periodFrom, to: run.periodTo });
    } catch (error) {
      // El plan ya no cubre ese historial: no mejora reintentando.
      if (error instanceof PlanLimitExceededException) return fail("PLAN_LIMIT");
      return this.retryOrFail(run.id, attempted.attempts, "BUILD_FAILED", error);
    }

    const pending = run.schedule.recipients.filter((to) => !run.deliveredTo.includes(to));
    const delivered = [...run.deliveredTo];
    let failure: unknown = null;
    if (pending.length > 0) {
      const link = await this.createEmailLink(run.organizationId, run.schedule, run.periodFrom, run.periodTo);
      const text = buildReportEmailText(report, run.schedule.label, link);
      for (const to of pending) {
        try {
          await this.email.send(
            await this.brandProfileService.brandEmail(
              run.organizationId,
              { to, subject: `Informe ${run.periodFrom} a ${run.periodTo} · ${report.organizationName}`, text },
              "customer",
            ),
          );
          delivered.push(to);
          // Cada entrega se anota al instante: un reintento no repite a quien ya recibió el correo.
          await this.prisma.reportRun.update({ where: { id: run.id }, data: { deliveredTo: delivered } });
        } catch (error) {
          failure = error;
        }
      }
    }
    if (failure !== null) return this.retryOrFail(run.id, attempted.attempts, "SEND_FAILED", failure);

    await this.prisma.reportRun.update({ where: { id: run.id }, data: { status: ReportRunStatus.SENT, sentAt: new Date(), errorCode: null, deliveredTo: delivered } });
    logger.info("report.run.sent", { runId: run.id, recipients: delivered.length });
    return ReportRunStatus.SENT;
  }

  private async retryOrFail(runId: string, attempts: number, errorCode: string, error: unknown): Promise<ReportRunStatus> {
    logger.warn("report.run.attempt_failed", { runId, attempts, errorCode, error: error instanceof Error ? error.message : String(error) });
    if (attempts >= REPORT_RUN_MAX_ATTEMPTS) {
      await this.prisma.reportRun.update({ where: { id: runId }, data: { status: ReportRunStatus.FAILED, errorCode } });
      return ReportRunStatus.FAILED;
    }
    await this.prisma.reportRun.update({ where: { id: runId }, data: { errorCode } });
    throw error instanceof Error ? error : new Error(errorCode);
  }

  /**
   * Enlace de solo lectura al informe para el correo. Es del sistema y por eso no cuenta contra el tope de enlaces manuales; vence solo.
   * Sin URL pública del sitio configurada, el correo lleva solo las cifras.
   */
  private async createEmailLink(organizationId: string, schedule: ReportSchedule, from: string, to: string): Promise<string | null> {
    if (!env.WEB_APP_URL) return null;
    const token = randomBytes(32).toString("base64url");
    await this.prisma.reportShareLink.create({
      data: {
        organizationId,
        tokenHash: hashShareToken(token),
        label: schedule.label ?? "Informe programado",
        periodFrom: from,
        periodTo: to,
        expiresAt: new Date(Date.now() + EMAIL_LINK_DAYS * DAY_MS),
        createdById: schedule.createdById,
      },
    });
    return `${env.WEB_APP_URL.replace(/\/$/, "")}/informe/${token}`;
  }
}
