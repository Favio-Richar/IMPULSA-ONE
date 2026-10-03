import { ConflictException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import type { EmailSequenceEnrollmentResponse, EmailSequenceResponse } from "@impulza/contracts";
import type { EmailSequence, EmailSequenceStep, PrismaClient } from "@impulza/database";
import { MAX_SEQUENCES_PER_ORGANIZATION, sequenceEmail, type CreateEmailSequenceInput, type SequenceStepInput, type UpdateEmailSequenceInput } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { sanitizeRichText } from "../blocks/sanitize.js";
import { BrandProfileService } from "../brand-profile/brand-profile.service.js";
import { PlansService } from "../plans/plans.service.js";

export const SEQUENCE_LIMIT_REACHED = "SEQUENCE_LIMIT_REACHED";
const NOT_FOUND = "Secuencia no encontrada.";
const ENROLLMENTS_PAGE = 50;
const DAY_MS = 24 * 3_600_000;

type SequenceWithSteps = EmailSequence & { steps: EmailSequenceStep[] };

/**
 * Secuencias de correo (F7.5, ADR-020): alta, edición (incluye encender/apagar y reemplazar los
 * pasos), baja, registro de inscripciones y envío de prueba. El cuerpo de cada paso se sanea en el
 * servidor. Al crear o encender se congela el límite por hora del plan (lo usa el worker). Todo
 * auditado y acotado a la organización.
 */
@Injectable()
export class SequencesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly plans: PlansService,
    private readonly audit: AuditService,
    private readonly brandProfileService: BrandProfileService,
  ) {}

  async list(organizationId: string): Promise<EmailSequenceResponse[]> {
    const sequences = await this.prisma.emailSequence.findMany({ where: { organizationId }, include: { steps: { orderBy: { position: "asc" } } }, orderBy: { createdAt: "asc" } });
    return Promise.all(sequences.map((sequence) => this.toResponse(sequence)));
  }

  async create(organizationId: string, actorId: string, input: CreateEmailSequenceInput): Promise<EmailSequenceResponse> {
    const count = await this.prisma.emailSequence.count({ where: { organizationId } });
    if (count >= MAX_SEQUENCES_PER_ORGANIZATION) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: "Unprocessable Entity",
        code: SEQUENCE_LIMIT_REACHED,
        message: `Puedes tener hasta ${MAX_SEQUENCES_PER_ORGANIZATION} secuencias. Borra una que ya no uses.`,
      });
    }
    const emailsPerHour = await this.planEmailsPerHour(organizationId);
    const sequence = await this.prisma.emailSequence.create({
      data: { organizationId, name: input.name, trigger: input.trigger, emailsPerHour, steps: { create: this.stepRows(input.steps) } },
      include: { steps: { orderBy: { position: "asc" } } },
    });
    await this.audit.record({ organizationId, actorId, action: "email_sequence.created", targetType: "EmailSequence", targetId: sequence.id, metadata: { trigger: input.trigger, steps: input.steps.length } });
    logger.info("secuencia creada", { organizationId, sequenceId: sequence.id, trigger: input.trigger });
    return this.toResponse(sequence);
  }

  async update(organizationId: string, actorId: string, sequenceId: string, input: UpdateEmailSequenceInput): Promise<EmailSequenceResponse> {
    const current = await this.getOrThrow(organizationId, sequenceId);
    const turningOn = input.enabled === true && !current.enabled;
    const emailsPerHour = turningOn || input.steps ? await this.planEmailsPerHour(organizationId) : current.emailsPerHour;
    const sequence = await this.prisma.$transaction(async (tx) => {
      if (input.steps) {
        // Los pasos se reemplazan completos; las inscripciones guardan solo la posición del próximo
        // correo, así que lo que falta enviar toma el contenido nuevo (ADR-020 §7).
        await tx.emailSequenceStep.deleteMany({ where: { sequenceId } });
        await tx.emailSequenceStep.createMany({ data: this.stepRows(input.steps).map((row) => ({ ...row, sequenceId })) });
      }
      return tx.emailSequence.update({
        where: { id: sequenceId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          emailsPerHour,
        },
        include: { steps: { orderBy: { position: "asc" } } },
      });
    });
    await this.audit.record({
      organizationId,
      actorId,
      action: input.enabled === false ? "email_sequence.paused" : turningOn ? "email_sequence.resumed" : "email_sequence.updated",
      targetType: "EmailSequence",
      targetId: sequenceId,
      metadata: { fields: Object.keys(input), ...(input.steps ? { steps: input.steps.length } : {}) },
    });
    return this.toResponse(sequence);
  }

  async remove(organizationId: string, actorId: string, sequenceId: string): Promise<void> {
    await this.getOrThrow(organizationId, sequenceId);
    await this.prisma.emailSequence.delete({ where: { id: sequenceId } });
    await this.audit.record({ organizationId, actorId, action: "email_sequence.deleted", targetType: "EmailSequence", targetId: sequenceId });
  }

  async enrollments(organizationId: string, sequenceId: string): Promise<EmailSequenceEnrollmentResponse[]> {
    await this.getOrThrow(organizationId, sequenceId);
    const rows = await this.prisma.emailSequenceEnrollment.findMany({
      where: { organizationId, sequenceId },
      include: { contact: { select: { id: true, name: true, email: true } }, _count: { select: { sends: { where: { status: "SENT" } } } } },
      orderBy: { enrolledAt: "desc" },
      take: ENROLLMENTS_PAGE,
    });
    return rows.map((row) => ({
      id: row.id,
      contact: row.contact,
      status: row.status,
      stopReason: row.stopReason,
      sentSteps: row._count.sends,
      nextStep: row.nextStep,
      nextSendAt: row.status === "ACTIVE" ? (row.nextSendAt?.toISOString() ?? null) : null,
      enrolledAt: row.enrolledAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    }));
  }

  /** Detener a una persona (el equipo lo decide): no recibe más correos de esta secuencia. */
  async stopEnrollment(organizationId: string, actorId: string, sequenceId: string, enrollmentId: string): Promise<void> {
    await this.getOrThrow(organizationId, sequenceId);
    const stopped = await this.prisma.emailSequenceEnrollment.updateMany({
      where: { id: enrollmentId, organizationId, sequenceId, status: "ACTIVE" },
      data: { status: "STOPPED", stopReason: "manual", nextSendAt: null, finishedAt: new Date() },
    });
    if (stopped.count === 0) {
      const exists = await this.prisma.emailSequenceEnrollment.count({ where: { id: enrollmentId, organizationId, sequenceId } });
      if (exists === 0) throw new NotFoundException("Inscripción no encontrada.");
      throw new ConflictException("La inscripción ya terminó.");
    }
    await this.audit.record({ organizationId, actorId, action: "email_sequence.enrollment_stopped", targetType: "EmailSequenceEnrollment", targetId: enrollmentId, metadata: { sequenceId } });
  }

  /** Envía un paso, marcado como prueba y sin enlace de baja real, al correo de quien lo pide. */
  async sendTest(organizationId: string, actor: { id: string; email: string; name?: string | null }, sequenceId: string, position: number): Promise<void> {
    const sequence = await this.getOrThrow(organizationId, sequenceId);
    const step = sequence.steps.find((candidate) => candidate.position === position);
    if (!step) throw new NotFoundException("Ese correo no existe en la secuencia.");
    const organization = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
    const content = sequenceEmail({ organizationName: organization.name, subject: step.subject, bodyHtml: step.bodyHtml, name: actor.name ?? null, unsubscribeUrl: null, test: true });
    await this.email.send(
      await this.brandProfileService.brandEmail(organizationId, { to: actor.email, subject: content.subject, text: content.text, html: content.html }),
    );
    await this.audit.record({ organizationId, actorId: actor.id, action: "email_sequence.test_sent", targetType: "EmailSequence", targetId: sequenceId, metadata: { position } });
  }

  private stepRows(steps: SequenceStepInput[]) {
    return steps.map((step, position) => ({ position, delayHours: step.delayHours, subject: step.subject, bodyHtml: sanitizeRichText(step.bodyHtml) }));
  }

  private async planEmailsPerHour(organizationId: string): Promise<number | null> {
    const { plan } = await this.plans.resolveEffectivePlan(organizationId);
    return plan.limits.emailsPerHour ?? null;
  }

  private async getOrThrow(organizationId: string, sequenceId: string): Promise<SequenceWithSteps> {
    const sequence = await this.prisma.emailSequence.findFirst({ where: { id: sequenceId, organizationId }, include: { steps: { orderBy: { position: "asc" } } } });
    if (!sequence) throw new NotFoundException(NOT_FOUND);
    return sequence;
  }

  private async toResponse(sequence: SequenceWithSteps): Promise<EmailSequenceResponse> {
    const [grouped, sentLast30Days] = await Promise.all([
      this.prisma.emailSequenceEnrollment.groupBy({ by: ["status"], where: { sequenceId: sequence.id }, _count: { _all: true } }),
      this.prisma.emailSequenceSend.count({ where: { status: "SENT", sentAt: { gte: new Date(Date.now() - 30 * DAY_MS) }, enrollment: { sequenceId: sequence.id } } }),
    ]);
    const count = (status: "ACTIVE" | "COMPLETED" | "STOPPED") => grouped.find((row) => row.status === status)?._count._all ?? 0;
    return {
      id: sequence.id,
      name: sequence.name,
      trigger: sequence.trigger,
      enabled: sequence.enabled,
      steps: sequence.steps.map((step) => ({ position: step.position, delayHours: step.delayHours, subject: step.subject, bodyHtml: step.bodyHtml })),
      stats: { active: count("ACTIVE"), completed: count("COMPLETED"), stopped: count("STOPPED"), sentLast30Days },
      createdAt: sequence.createdAt.toISOString(),
      updatedAt: sequence.updatedAt.toISOString(),
    };
  }
}
