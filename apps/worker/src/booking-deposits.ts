import type { EmailAdapter } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { bookingDepositExpiredEmail } from "@impulza/validation";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

export const BOOKING_DEPOSITS_QUEUE = "booking-deposits";
/**
 * Margen después del plazo antes de liberar la hora: un pago hecho en el último minuto puede tardar
 * en confirmarse en Mercado Pago. Si igual llega tarde, la API reconfirma la reserva si la hora
 * sigue libre (F5.10).
 */
export const DEPOSIT_RELEASE_GRACE_MS = 5 * 60_000;
const BATCH = 200;

/**
 * Libera las horas cuya seña no se pagó a tiempo (F5.10): la reserva pasa a cancelada con
 * `paymentExpiredAt` y el cliente recibe el aviso. Cada una se reclama con un `updateMany`
 * condicional (sigue esperando seña y sin pago asignado): si el pago llegó justo antes, no se toca,
 * y dos ejecuciones cruzadas nunca avisan dos veces.
 */
export async function releaseExpiredDeposits(prisma: PrismaClient, email: EmailAdapter, now: Date = new Date()): Promise<number> {
  const due = await prisma.booking.findMany({
    where: { status: "PENDING_PAYMENT", providerPaymentId: null, paymentDeadline: { lt: new Date(now.getTime() - DEPOSIT_RELEASE_GRACE_MS) } },
    include: { site: { select: { name: true } } },
    orderBy: { paymentDeadline: "asc" },
    take: BATCH,
  });

  let released = 0;
  for (const booking of due) {
    const claimed = await prisma.booking.updateMany({
      where: { id: booking.id, status: "PENDING_PAYMENT", providerPaymentId: null },
      data: { status: "CANCELLED", cancelledAt: now, paymentExpiredAt: now },
    });
    if (claimed.count !== 1) continue;
    released += 1;
    const content = bookingDepositExpiredEmail({
      siteName: booking.site.name,
      serviceName: booking.serviceName,
      startsAt: booking.startsAt.toISOString(),
      timeZone: booking.timeZone,
      priceAmount: booking.priceAmount,
      priceCurrency: booking.priceCurrency,
      paymentUrl: null,
      manageUrl: null,
    });
    try {
      await email.send({ to: booking.customerEmail, subject: content.subject, text: content.text });
    } catch (error) {
      // La hora ya se liberó; el correo no se reintenta (no hay nada que el cliente deba hacer).
      logger.error("booking.deposit.expired_email_failed", { bookingId: booking.id, err: error });
    }
    logger.info("booking.deposit.expired", { organizationId: booking.organizationId, bookingId: booking.id });
  }
  return released;
}

export interface BookingDepositWorkers {
  close(): Promise<void>;
}

/** Revisa cada minuto: una hora tomada sin pagar no debe bloquear la agenda mucho más que el plazo. */
export async function startBookingDepositWorkers(options: { prisma: PrismaClient; email: EmailAdapter; connection: ConnectionOptions }): Promise<BookingDepositWorkers> {
  const queue = new Queue(BOOKING_DEPOSITS_QUEUE, { connection: options.connection });
  await queue.upsertJobScheduler("booking-deposits-every-minute", { pattern: "0 * * * * *" }, { name: "release-expired-deposits" });
  const worker = new Worker(
    BOOKING_DEPOSITS_QUEUE,
    async () => {
      const released = await releaseExpiredDeposits(options.prisma, options.email);
      if (released > 0) logger.info("booking.deposits.released", { released });
      return released;
    },
    { connection: options.connection },
  );
  worker.on("failed", (job, error) => logger.error("booking.deposits.failed", { jobId: job?.id, err: error }));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
