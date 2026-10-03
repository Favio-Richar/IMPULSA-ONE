import { signSequenceUnsubscribeToken, type EmailAdapter } from "@impulza/auth";
import { Prisma, type PrismaClient } from "@impulza/database";
import { automationEventKey, DEFAULT_EMAILS_PER_HOUR, SEQUENCE_CLAIM_LEASE_MS, sequenceEmail, type AutomationEventJob, type SequenceStopReason } from "@impulza/validation";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";
import { brandOrganizationEmail } from "./brand.js";

export const SEQUENCE_DISPATCH_QUEUE = "sequence-dispatch";
const HOUR_MS = 3_600_000;
/** Inscripciones vencidas que se miran por pasada (la pasada corre cada minuto). */
const BATCH = 200;

/**
 * Inscribe al contacto del evento en las secuencias encendidas de ese disparador (F7.5, ADR-020):
 * **una vez por secuencia** (único `sequence_id + contact_id`, `skipDuplicates`), y solo si tiene
 * correo y consentimiento de marketing vigente. El primer correo queda a la hora del evento más la
 * espera del primer paso. Idempotente: el mismo evento procesado dos veces no inscribe dos veces.
 */
export async function enrollInSequences(prisma: PrismaClient, job: AutomationEventJob): Promise<number> {
  if (!job.contactId) return 0;
  const sequences = await prisma.emailSequence.findMany({
    where: { organizationId: job.organizationId, trigger: job.trigger, enabled: true },
    include: { steps: { orderBy: { position: "asc" }, take: 1 } },
  });
  const withSteps = sequences.filter((sequence) => sequence.steps.length > 0);
  if (withSteps.length === 0) return 0;
  const contact = await prisma.contact.findFirst({
    where: { id: job.contactId, organizationId: job.organizationId },
    select: { id: true, email: true, marketingConsentAt: true, marketingUnsubscribedAt: true },
  });
  if (!contact?.email || contact.marketingConsentAt === null || contact.marketingUnsubscribedAt !== null) {
    logger.info("sequence.enroll.skipped", { organizationId: job.organizationId, trigger: job.trigger, reason: contact ? "no_consent_or_email" : "contact_missing" });
    return 0;
  }
  const occurredAt = new Date(job.occurredAt);
  const base = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
  const created = await prisma.emailSequenceEnrollment.createMany({
    data: withSteps.map((sequence) => ({
      organizationId: job.organizationId,
      sequenceId: sequence.id,
      contactId: contact.id,
      eventKey: automationEventKey(job.trigger, job.subjectId),
      nextStep: sequence.steps[0]!.position,
      nextSendAt: new Date(base.getTime() + sequence.steps[0]!.delayHours * HOUR_MS),
      enrolledAt: base,
    })),
    skipDuplicates: true,
  });
  if (created.count > 0) logger.info("sequence.enrolled", { organizationId: job.organizationId, trigger: job.trigger, enrollments: created.count });
  return created.count;
}

export interface SequenceDispatchOptions {
  publicSiteBaseUrl?: string;
  linkSecret?: string;
  now?: Date;
  /** Solo pruebas: con el reloj adelantado, nunca tocar inscripciones de otras suites. */
  organizationId?: string;
}

export interface SequenceDispatchResult {
  sent: number;
  completed: number;
  stopped: number;
  deferred: number;
}

/**
 * Envía los correos de secuencia que ya tocan (ADR-020 §5–6). Por cada inscripción vencida:
 * - la **reclama** corriendo su hora `SEQUENCE_CLAIM_LEASE_MS` (condicional al estado leído): dos
 *   pasadas nunca toman la misma, y si el proceso muere se reintenta después de la concesión;
 * - vuelve a mirar el contacto: sin correo o sin consentimiento vigente, la detiene;
 * - registra el envío en una fila **única** por inscripción y paso antes de enviar: un reintento
 *   nunca manda dos veces;
 * - programa el paso siguiente que exista (un paso borrado se salta) o la cierra.
 * Respeta el límite por hora congelado en la secuencia, compartido con las campañas de la
 * organización: lo que no cabe espera a la pasada siguiente sin perder su turno.
 */
export async function dispatchSequences(prisma: PrismaClient, email: EmailAdapter, options: SequenceDispatchOptions = {}): Promise<SequenceDispatchResult> {
  const now = options.now ?? new Date();
  const result: SequenceDispatchResult = { sent: 0, completed: 0, stopped: 0, deferred: 0 };
  const due = await prisma.emailSequenceEnrollment.findMany({
    where: {
      status: "ACTIVE",
      nextSendAt: { lte: now },
      sequence: { enabled: true },
      organization: { status: "ACTIVE" },
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    },
    include: {
      sequence: { include: { steps: { orderBy: { position: "asc" } } } },
      contact: { select: { name: true, email: true, marketingConsentAt: true, marketingUnsubscribedAt: true } },
      organization: { select: { name: true } },
    },
    orderBy: { nextSendAt: "asc" },
    take: BATCH,
  });
  if (due.length === 0) return result;
  if (!options.publicSiteBaseUrl || !options.linkSecret) {
    // Todo correo de secuencia lleva su enlace de baja: sin él no se envía nada.
    logger.error("sequence.dispatch.links_not_configured", { due: due.length });
    return result;
  }
  const baseUrl = options.publicSiteBaseUrl.replace(/\/$/, "");
  const remaining = new Map<string, number>();

  for (const enrollment of due) {
    const { sequence, contact } = enrollment;

    // Límite por hora de la organización (campañas + secuencias en la última hora).
    if (!remaining.has(enrollment.organizationId)) {
      const since = new Date(now.getTime() - HOUR_MS);
      const [campaignSent, sequenceSent] = await Promise.all([
        prisma.campaignRecipient.count({ where: { organizationId: enrollment.organizationId, status: "SENT", sentAt: { gt: since } } }),
        prisma.emailSequenceSend.count({ where: { organizationId: enrollment.organizationId, status: "SENT", sentAt: { gt: since } } }),
      ]);
      remaining.set(enrollment.organizationId, (sequence.emailsPerHour ?? DEFAULT_EMAILS_PER_HOUR) - campaignSent - sequenceSent);
    }
    if ((remaining.get(enrollment.organizationId) ?? 0) <= 0) {
      result.deferred += 1;
      continue;
    }

    const claimed = await prisma.emailSequenceEnrollment.updateMany({
      where: { id: enrollment.id, status: "ACTIVE", nextStep: enrollment.nextStep, nextSendAt: enrollment.nextSendAt },
      data: { nextSendAt: new Date(now.getTime() + SEQUENCE_CLAIM_LEASE_MS) },
    });
    if (claimed.count !== 1) continue;

    const step = sequence.steps.find((candidate) => candidate.position >= enrollment.nextStep);
    if (!step) {
      await close(prisma, enrollment.id, now, null);
      result.completed += 1;
      continue;
    }

    const stopReason: SequenceStopReason | null = !contact.email
      ? "no_email"
      : contact.marketingUnsubscribedAt !== null
        ? "unsubscribed"
        : contact.marketingConsentAt === null
          ? "no_consent"
          : null;
    if (stopReason) {
      await close(prisma, enrollment.id, now, stopReason);
      result.stopped += 1;
      continue;
    }

    // Fila única antes de enviar: si ya existe (un intento anterior murió después de enviar), no se
    // reenvía; solo se avanza.
    let fresh = true;
    try {
      await prisma.emailSequenceSend.create({
        data: { organizationId: enrollment.organizationId, enrollmentId: enrollment.id, stepPosition: step.position, status: "SENT", sentAt: now },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        fresh = false;
      } else {
        throw error;
      }
    }

    if (fresh) {
      const token = signSequenceUnsubscribeToken(enrollment.id, options.linkSecret);
      const content = sequenceEmail({
        organizationName: enrollment.organization.name,
        subject: step.subject,
        bodyHtml: step.bodyHtml,
        name: contact.name,
        unsubscribeUrl: `${baseUrl}/baja/${token}`,
      });
      try {
        await email.send(await brandOrganizationEmail(prisma, enrollment.organizationId, {
          to: contact.email!,
          subject: content.subject,
          text: content.text,
          html: content.html,
          headers: { "List-Unsubscribe": `<${baseUrl}/api/unsubscribe/${token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        }));
        result.sent += 1;
        remaining.set(enrollment.organizationId, (remaining.get(enrollment.organizationId) ?? 0) - 1);
      } catch (error) {
        await prisma.emailSequenceSend.updateMany({
          where: { enrollmentId: enrollment.id, stepPosition: step.position },
          data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 300) : "Error al enviar." },
        });
        logger.error("sequence.send.failed", { organizationId: enrollment.organizationId, enrollmentId: enrollment.id, err: error });
      }
    }

    const next = sequence.steps.find((candidate) => candidate.position > step.position);
    if (next) {
      await prisma.emailSequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { nextStep: next.position, nextSendAt: new Date(now.getTime() + next.delayHours * HOUR_MS) },
      });
    } else {
      await close(prisma, enrollment.id, now, null);
      result.completed += 1;
    }
  }
  return result;
}

async function close(prisma: PrismaClient, enrollmentId: string, now: Date, reason: SequenceStopReason | null): Promise<void> {
  await prisma.emailSequenceEnrollment.update({
    where: { id: enrollmentId },
    data: reason ? { status: "STOPPED", stopReason: reason, nextSendAt: null, finishedAt: now } : { status: "COMPLETED", nextSendAt: null, finishedAt: now },
  });
}

export interface SequenceWorkers {
  close(): Promise<void>;
}

/** Una pasada por minuto envía lo que ya toca. */
export async function startSequenceWorkers(options: {
  prisma: PrismaClient;
  email: EmailAdapter;
  connection: ConnectionOptions;
  publicSiteBaseUrl?: string;
  linkSecret?: string;
}): Promise<SequenceWorkers> {
  const queue = new Queue(SEQUENCE_DISPATCH_QUEUE, { connection: options.connection });
  await queue.upsertJobScheduler("sequence-dispatch-every-minute", { pattern: "30 * * * * *" }, { name: "dispatch-sequences" });
  const worker = new Worker(
    SEQUENCE_DISPATCH_QUEUE,
    async () => {
      const result = await dispatchSequences(options.prisma, options.email, { publicSiteBaseUrl: options.publicSiteBaseUrl, linkSecret: options.linkSecret });
      if (result.sent + result.completed + result.stopped + result.deferred > 0) logger.info("sequence.dispatch", { ...result });
      return result;
    },
    // Una pasada a la vez: el reclamo por inscripción ya evita duplicados, esto evita trabajo doble.
    { connection: options.connection, concurrency: 1 },
  );
  worker.on("failed", (job, error) => logger.error("sequence.dispatch.failed", { jobId: job?.id, err: error }));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
