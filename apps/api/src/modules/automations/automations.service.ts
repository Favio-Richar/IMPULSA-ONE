import { HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { Automation, Prisma, PrismaClient } from "@impulza/database";
import { MAX_AUTOMATIONS_PER_ORGANIZATION, automationActionSchema, type CreateAutomationInput, type UpdateAutomationInput } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";

export const AUTOMATION_LIMIT_REACHED = "AUTOMATION_LIMIT_REACHED";
const RUNS_PAGE = 50;

/**
 * Automatizaciones de la organización (F6.7): alta, edición (incluye encender/apagar), baja y el
 * registro de ejecuciones. Cada cambio queda en la auditoría; las ejecuciones las escribe el worker.
 */
@Injectable()
export class AutomationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async list(organizationId: string) {
    const automations = await this.prisma.automation.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    const since = new Date(Date.now() - 30 * 24 * 3_600_000);
    const stats = await this.prisma.automationRun.groupBy({
      by: ["automationId", "status"],
      where: { organizationId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const last = await this.prisma.automationRun.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      distinct: ["automationId"],
      select: { automationId: true, createdAt: true, status: true },
    });
    return automations.map((automation) => ({
      ...this.toResponse(automation),
      runsLast30Days: {
        succeeded: stats.find((row) => row.automationId === automation.id && row.status === "SUCCEEDED")?._count._all ?? 0,
        failed: stats.find((row) => row.automationId === automation.id && row.status === "FAILED")?._count._all ?? 0,
      },
      lastRun: last.find((row) => row.automationId === automation.id) ?? null,
    }));
  }

  async create(organizationId: string, actorId: string, input: CreateAutomationInput) {
    const count = await this.prisma.automation.count({ where: { organizationId } });
    if (count >= MAX_AUTOMATIONS_PER_ORGANIZATION) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: "Unprocessable Entity",
        code: AUTOMATION_LIMIT_REACHED,
        message: `Puedes tener hasta ${MAX_AUTOMATIONS_PER_ORGANIZATION} automatizaciones. Borra una que ya no uses.`,
      });
    }
    const automation = await this.prisma.automation.create({
      data: { organizationId, name: input.name, trigger: input.trigger, action: input.action as Prisma.InputJsonValue },
    });
    await this.auditService.record({ organizationId, actorId, action: "automation.created", targetType: "Automation", targetId: automation.id, metadata: { trigger: input.trigger, action: input.action.type } });
    logger.info("automatización creada", { organizationId, automationId: automation.id, trigger: input.trigger, action: input.action.type });
    return { ...this.toResponse(automation), runsLast30Days: { succeeded: 0, failed: 0 }, lastRun: null };
  }

  async update(organizationId: string, actorId: string, automationId: string, input: UpdateAutomationInput) {
    await this.getOrThrow(organizationId, automationId);
    const automation = await this.prisma.automation.update({
      where: { id: automationId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.action !== undefined ? { action: input.action as Prisma.InputJsonValue } : {}),
      },
    });
    await this.auditService.record({ organizationId, actorId, action: "automation.updated", targetType: "Automation", targetId: automationId, metadata: { fields: Object.keys(input) } });
    return this.toResponse(automation);
  }

  async remove(organizationId: string, actorId: string, automationId: string): Promise<void> {
    await this.getOrThrow(organizationId, automationId);
    await this.prisma.automation.delete({ where: { id: automationId } });
    await this.auditService.record({ organizationId, actorId, action: "automation.deleted", targetType: "Automation", targetId: automationId });
  }

  /** Últimas ejecuciones: estado, cuándo y el motivo técnico si falló (nunca datos del contacto). */
  async runs(organizationId: string, automationId: string) {
    await this.getOrThrow(organizationId, automationId);
    const runs = await this.prisma.automationRun.findMany({
      where: { organizationId, automationId },
      orderBy: { createdAt: "desc" },
      take: RUNS_PAGE,
      select: { id: true, trigger: true, subjectId: true, status: true, attempts: true, detail: true, createdAt: true, finishedAt: true },
    });
    return runs;
  }

  private async getOrThrow(organizationId: string, automationId: string): Promise<Automation> {
    const automation = await this.prisma.automation.findFirst({ where: { id: automationId, organizationId } });
    if (!automation) {
      throw new NotFoundException("Automatización no encontrada.");
    }
    return automation;
  }

  private toResponse(automation: Automation) {
    const action = automationActionSchema.safeParse(automation.action);
    return {
      id: automation.id,
      name: automation.name,
      trigger: automation.trigger,
      action: action.success ? action.data : { type: "notify_team" as const },
      actionValid: action.success,
      enabled: automation.enabled,
      createdAt: automation.createdAt,
      updatedAt: automation.updatedAt,
    };
  }
}
