import { signBookingLinkToken, type EmailAdapter } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { bookingReminderEmail } from "@impulza/validation";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

export const BOOKING_REMINDERS_QUEUE = "booking-reminders";
const HOUR = 3_600_000;
/** El recordatorio sale dentro de las 24 h previas a la cita. */
const REMIND_WITHIN_MS = 24 * HOUR;
/** Si falta menos de una hora ya no sirve de recordatorio. */
const TOO_CLOSE_MS = HOUR;
const BATCH = 200;

export interface ReminderOptions {
  publicSiteBaseUrl?: string;
  bookingLinkSecret?: string;
  now?: Date;
}

/**
 * Envía los recordatorios que tocan (F5.4): reservas confirmadas que empiezan entre 1 y 24 horas
 * más, sin recordatorio todavía y hechas con más de un día de anticipación (a quien reservó hace un
 * rato le basta la confirmación). Cada reserva se **reclama** con un `updateMany` condicional antes
 * de enviar: si dos ejecuciones se cruzan, solo una la toma y el cliente nunca recibe dos. Si el
 * envío falla, se libera para el próximo intento.
 */
export async function sendDueBookingReminders(prisma: PrismaClient, email: EmailAdapter, options: ReminderOptions = {}): Promise<number> {
  const now = options.now ?? new Date();
  const due = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      reminderSentAt: null,
      startsAt: { gt: new Date(now.getTime() + TOO_CLOSE_MS), lte: new Date(now.getTime() + REMIND_WITHIN_MS) },
      site: { status: { not: "ARCHIVED" }, organization: { status: "ACTIVE" } },
    },
    include: { site: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
    take: BATCH,
  });

  let sent = 0;
  for (const booking of due) {
    if (booking.createdAt.getTime() > booking.startsAt.getTime() - REMIND_WITHIN_MS) {
      continue;
    }
    const claimed = await prisma.booking.updateMany({
      where: { id: booking.id, status: "CONFIRMED", reminderSentAt: null },
      data: { reminderSentAt: now },
    });
    if (claimed.count !== 1) {
      continue;
    }
    const manageUrl =
      options.publicSiteBaseUrl && options.bookingLinkSecret
        ? `${options.publicSiteBaseUrl.replace(/\/$/, "")}/reserva/${signBookingLinkToken(booking.id, options.bookingLinkSecret)}`
        : null;
    const content = bookingReminderEmail({
      siteName: booking.site.name,
      serviceName: booking.serviceName,
      startsAt: booking.startsAt.toISOString(),
      timeZone: booking.timeZone,
      priceAmount: booking.priceAmount,
      priceCurrency: booking.priceCurrency,
      paymentUrl: booking.paymentUrl,
      manageUrl,
    });
    try {
      await email.send({ to: booking.customerEmail, subject: content.subject, text: content.text });
      sent += 1;
    } catch (error) {
      await prisma.booking.updateMany({ where: { id: booking.id, reminderSentAt: now }, data: { reminderSentAt: null } });
      logger.error("booking.reminder.failed", { bookingId: booking.id, err: error });
    }
  }
  return sent;
}

export interface BookingReminderWorkers {
  close(): Promise<void>;
}

/** Revisa cada 10 minutos qué recordatorios tocan. */
export async function startBookingReminderWorkers(options: {
  prisma: PrismaClient;
  email: EmailAdapter;
  connection: ConnectionOptions;
  publicSiteBaseUrl?: string;
  bookingLinkSecret?: string;
}): Promise<BookingReminderWorkers> {
  const queue = new Queue(BOOKING_REMINDERS_QUEUE, { connection: options.connection });
  await queue.upsertJobScheduler("booking-reminders-every-10-min", { pattern: "0 */10 * * * *" }, { name: "send-due-reminders" });
  const worker = new Worker(
    BOOKING_REMINDERS_QUEUE,
    async () => {
      const sent = await sendDueBookingReminders(options.prisma, options.email, {
        publicSiteBaseUrl: options.publicSiteBaseUrl,
        bookingLinkSecret: options.bookingLinkSecret,
      });
      if (sent > 0) {
        logger.info("booking.reminders.sent", { sent });
      }
      return sent;
    },
    { connection: options.connection },
  );
  worker.on("failed", (job, error) => logger.error("booking.reminders.failed", { jobId: job?.id, err: error }));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
