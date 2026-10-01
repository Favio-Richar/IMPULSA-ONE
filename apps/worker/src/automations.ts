import type { EmailAdapter } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import {
  AUTOMATION_EVENTS_QUEUE,
  automationActionSchema,
  automationEventKey,
  automationNoticeEmail,
  formatBookingWhen,
  type AutomationAction,
  type AutomationEventJob,
} from "@impulza/validation";
import { type ConnectionOptions, Worker } from "bullmq";
import { logger } from "./observability/logger.js";
import { enrollInSequences } from "./sequences.js";

export interface AutomationProcessOptions {
  /** Origen del panel (`APP_BASE_URL`) para el enlace del aviso; sin él, el aviso va sin enlace. */
  dashboardBaseUrl?: string;
}

export interface AutomationProcessResult {
  succeeded: number;
  skipped: number;
  failed: number;
}

/** Resultado de una acción: hecha, u omitida con su motivo (sin datos personales). */
type ActionOutcome = { status: "SUCCEEDED" } | { status: "SKIPPED"; detail: string };

class AutomationActionError extends Error {}

/**
 * Procesa un evento (F6.7): corre cada automatización encendida de la organización para ese
 * disparador, **a lo sumo una vez por evento**. La ejecución se registra antes de actuar (fila única
 * por automatización y evento): una que ya terminó no se repite aunque el trabajo llegue dos veces;
 * una que falló se reintenta en el siguiente intento del trabajo. Todo se lee de la base al procesar
 * y siempre dentro de la organización del evento.
 */
export async function processAutomationEvent(
  prisma: PrismaClient,
  email: EmailAdapter,
  job: AutomationEventJob,
  options: AutomationProcessOptions = {},
): Promise<AutomationProcessResult> {
  const result: AutomationProcessResult = { succeeded: 0, skipped: 0, failed: 0 };
  const organization = await prisma.organization.findFirst({ where: { id: job.organizationId, status: "ACTIVE" }, select: { name: true } });
  if (!organization) {
    return result;
  }
  // Secuencias de correo (F7.5): el mismo evento inscribe al contacto (idempotente). Antes de las
  // acciones: si una acción falla y el trabajo se reintenta, la inscripción no se duplica.
  await enrollInSequences(prisma, job);
  const automations = await prisma.automation.findMany({
    where: { organizationId: job.organizationId, trigger: job.trigger, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  const eventKey = automationEventKey(job.trigger, job.subjectId);
  const failures: string[] = [];

  for (const automation of automations) {
    const run = await prisma.automationRun.upsert({
      where: { automationId_eventKey: { automationId: automation.id, eventKey } },
      create: { organizationId: job.organizationId, automationId: automation.id, eventKey, trigger: job.trigger, subjectId: job.subjectId },
      update: {},
    });
    if (run.status === "SUCCEEDED" || run.status === "SKIPPED") {
      continue;
    }
    await prisma.automationRun.update({ where: { id: run.id }, data: { attempts: { increment: 1 } } });

    let outcome: ActionOutcome;
    try {
      const action = automationActionSchema.safeParse(automation.action);
      outcome = action.success
        ? await runAction(prisma, email, job, action.data, { organizationName: organization.name, automationName: automation.name, ...options })
        : { status: "SKIPPED", detail: "La configuración guardada ya no es válida." };
    } catch (error) {
      const detail = error instanceof AutomationActionError ? error.message : "Error inesperado al ejecutar la acción.";
      await prisma.automationRun.update({ where: { id: run.id }, data: { status: "FAILED", detail, finishedAt: new Date() } });
      logger.error("automation.run.failed", { automationId: automation.id, runId: run.id, trigger: job.trigger, err: error });
      failures.push(automation.id);
      result.failed += 1;
      continue;
    }

    await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: outcome.status, detail: outcome.status === "SKIPPED" ? outcome.detail : null, finishedAt: new Date() },
    });
    result[outcome.status === "SUCCEEDED" ? "succeeded" : "skipped"] += 1;
    logger.info("automation.run", { automationId: automation.id, runId: run.id, trigger: job.trigger, status: outcome.status });
  }

  if (failures.length > 0) {
    // BullMQ reintenta el trabajo: lo terminado se salta, solo lo fallido vuelve a correr.
    throw new Error(`${failures.length} automatizaciones fallaron para ${eventKey}`);
  }
  return result;
}

async function runAction(
  prisma: PrismaClient,
  email: EmailAdapter,
  job: AutomationEventJob,
  action: AutomationAction,
  context: { organizationName: string; automationName: string; dashboardBaseUrl?: string },
): Promise<ActionOutcome> {
  const contact = job.contactId
    ? await prisma.contact.findFirst({ where: { id: job.contactId, organizationId: job.organizationId }, select: { id: true, name: true, email: true, phone: true } })
    : null;

  switch (action.type) {
    case "tag_contact": {
      if (!contact) {
        return { status: "SKIPPED", detail: "El evento no tiene un contacto al que etiquetar." };
      }
      // Atómico e idempotente: solo agrega la etiqueta si no la tiene.
      await prisma.$executeRaw`UPDATE contacts SET tags = array_append(tags, ${action.tag}), updated_at = now() WHERE id = ${contact.id}::uuid AND NOT (${action.tag} = ANY(tags))`;
      return { status: "SUCCEEDED" };
    }
    case "set_commercial_status": {
      if (!contact) {
        return { status: "SKIPPED", detail: "El evento no tiene un contacto al que cambiarle el estado." };
      }
      await prisma.contact.update({ where: { id: contact.id }, data: { commercialStatus: action.status } });
      return { status: "SUCCEEDED" };
    }
    case "notify_team": {
      const members = await prisma.membership.findMany({
        where: { organizationId: job.organizationId, status: "ACTIVE", role: { name: { in: ["OWNER", "ADMIN"] } } },
        select: { user: { select: { email: true } } },
      });
      if (members.length === 0) {
        return { status: "SKIPPED", detail: "No hay dueños ni administradores activos a quienes avisar." };
      }
      const base = context.dashboardBaseUrl?.replace(/\/$/, "");
      const content = automationNoticeEmail({
        organizationName: context.organizationName,
        automationName: context.automationName,
        trigger: job.trigger,
        contact: contact ? { name: contact.name, email: contact.email, phone: contact.phone } : null,
        detail: await eventDetail(prisma, job),
        // Rutas reales del panel: ficha del contacto, o la lista de pedidos / la agenda (`/reservas`).
        dashboardUrl: base ? (contact ? `${base}/contactos/${contact.id}` : `${base}/${job.trigger === "order_created" ? "pedidos" : "reservas"}`) : null,
      });
      for (const member of members) {
        try {
          await email.send({ to: member.user.email, subject: content.subject, text: content.text });
        } catch {
          throw new AutomationActionError("El proveedor de correo no aceptó el aviso.");
        }
      }
      return { status: "SUCCEEDED" };
    }
  }
}

/** Una línea con lo que pasó: servicio y hora de la reserva, o producto y total del pedido. */
async function eventDetail(prisma: PrismaClient, job: AutomationEventJob): Promise<string | null> {
  if (job.trigger === "booking_created") {
    const booking = await prisma.booking.findFirst({ where: { id: job.subjectId, organizationId: job.organizationId }, select: { serviceName: true, startsAt: true, timeZone: true } });
    return booking ? `${booking.serviceName} · ${formatBookingWhen(booking.startsAt.toISOString(), booking.timeZone)}` : null;
  }
  if (job.trigger === "order_created") {
    const order = await prisma.order.findFirst({ where: { id: job.subjectId, organizationId: job.organizationId }, select: { productName: true, quantity: true, totalAmount: true, priceCurrency: true } });
    if (!order) {
      return null;
    }
    const digits = new Intl.NumberFormat("es-CL", { style: "currency", currency: order.priceCurrency }).resolvedOptions().maximumFractionDigits ?? 2;
    const total = new Intl.NumberFormat("es-CL", { style: "currency", currency: order.priceCurrency }).format(order.totalAmount / 10 ** digits);
    return `${order.productName} × ${order.quantity} · ${total}`;
  }
  return null;
}

export interface AutomationWorkers {
  close(): Promise<void>;
}

export function startAutomationWorkers(options: {
  prisma: PrismaClient;
  email: EmailAdapter;
  connection: ConnectionOptions;
  dashboardBaseUrl?: string;
}): AutomationWorkers {
  const worker = new Worker<AutomationEventJob>(
    AUTOMATION_EVENTS_QUEUE,
    async (job) => processAutomationEvent(options.prisma, options.email, job.data, { dashboardBaseUrl: options.dashboardBaseUrl }),
    { connection: options.connection, concurrency: 5 },
  );
  worker.on("failed", (job, error) => logger.error("automation.job.failed", { jobId: job?.id, attemptsMade: job?.attemptsMade, err: error }));
  return {
    async close() {
      await worker.close();
    },
  };
}
