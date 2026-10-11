import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { ReportCommentResponse } from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { CLIENT_VIEWER_ROLE, REPORT_COMMENTS_PER_PERIOD_MAX, type CreateReportCommentDto, type ReportQuery } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";

const SELECT = {
  id: true,
  periodFrom: true,
  periodTo: true,
  body: true,
  fromClient: true,
  createdAt: true,
  author: { select: { id: true, email: true } },
} as const;

type Row = {
  id: string;
  periodFrom: string;
  periodTo: string;
  body: string;
  fromClient: boolean;
  createdAt: Date;
  author: { id: string; email: string } | null;
};

function toResponse(row: Row): ReportCommentResponse {
  return {
    id: row.id,
    period: { from: row.periodFrom, to: row.periodTo },
    body: row.body,
    author: row.author,
    fromClient: row.fromClient,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Comentarios del informe de un periodo (F9.8d, ADR-028 §6). El hilo es de **una organización y un periodo**: toda consulta filtra por
 * `organizationId`, así que el comentario de otra organización nunca aparece ni se puede responder (ADR-002). Quien escribe desde el
 * portal (rol de solo revisión) queda marcado `fromClient`, fijado al escribir.
 */
@Injectable()
export class ReportCommentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async list(organizationId: string, period: ReportQuery): Promise<ReportCommentResponse[]> {
    const rows = await this.prisma.reportComment.findMany({
      where: { organizationId, periodFrom: period.from, periodTo: period.to },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: REPORT_COMMENTS_PER_PERIOD_MAX,
      select: SELECT,
    });
    return rows.map(toResponse);
  }

  async add(organizationId: string, actorId: string, period: ReportQuery, dto: CreateReportCommentDto): Promise<ReportCommentResponse> {
    const count = await this.prisma.reportComment.count({ where: { organizationId, periodFrom: period.from, periodTo: period.to } });
    if (count >= REPORT_COMMENTS_PER_PERIOD_MAX) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: "COMMENT_LIMIT",
        message: `Este periodo ya tiene ${REPORT_COMMENTS_PER_PERIOD_MAX} comentarios.`,
      });
    }
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: actorId, organizationId } },
      select: { role: { select: { name: true } } },
    });
    const row = await this.prisma.reportComment.create({
      data: {
        organizationId,
        periodFrom: period.from,
        periodTo: period.to,
        authorId: actorId,
        fromClient: membership?.role.name === CLIENT_VIEWER_ROLE,
        body: dto.body,
      },
      select: SELECT,
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "report.commented",
      targetType: "ReportComment",
      targetId: row.id,
      // El texto del comentario no va a la auditoría: solo a qué periodo se refiere.
      metadata: { from: period.from, to: period.to },
    });
    return toResponse(row);
  }
}
