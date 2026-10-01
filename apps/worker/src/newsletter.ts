import type { PrismaClient } from "@impulza/database";
import { NEWSLETTER_CONFIRMED_RETENTION_DAYS } from "@impulza/validation";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";

export const NEWSLETTER_QUEUE = "newsletter-maintenance";
const DAY_MS = 24 * 3_600_000;

/**
 * Minimización (F7.4, ADR-019 §4): borra las solicitudes de suscripción que nadie confirmó (un día
 * después de vencer) y las ya confirmadas de más de 30 días. La prueba del consentimiento queda en
 * el contacto y en la auditoría; esto solo guardaba el correo mientras hacía falta.
 * `organizationId` solo en pruebas: con el reloj adelantado, nunca tocar datos de otras suites.
 */
export async function purgeNewsletterConfirmations(
  prisma: PrismaClient,
  now: Date = new Date(),
  scope: { organizationId?: string } = {},
): Promise<{ unconfirmed: number; confirmed: number }> {
  const scoped = scope.organizationId ? { organizationId: scope.organizationId } : {};
  const unconfirmed = await prisma.newsletterConfirmation.deleteMany({
    where: { ...scoped, confirmedAt: null, expiresAt: { lt: new Date(now.getTime() - DAY_MS) } },
  });
  const confirmed = await prisma.newsletterConfirmation.deleteMany({
    where: { ...scoped, confirmedAt: { lt: new Date(now.getTime() - NEWSLETTER_CONFIRMED_RETENTION_DAYS * DAY_MS) } },
  });
  return { unconfirmed: unconfirmed.count, confirmed: confirmed.count };
}

export interface NewsletterWorkers {
  close(): Promise<void>;
}

/** Una pasada diaria, de madrugada. */
export async function startNewsletterWorkers(options: { prisma: PrismaClient; connection: ConnectionOptions }): Promise<NewsletterWorkers> {
  const queue = new Queue(NEWSLETTER_QUEUE, { connection: options.connection });
  await queue.upsertJobScheduler("newsletter-purge-daily", { pattern: "0 45 4 * * *" }, { name: "purge-confirmations" });
  const worker = new Worker(
    NEWSLETTER_QUEUE,
    async () => {
      const purged = await purgeNewsletterConfirmations(options.prisma);
      if (purged.unconfirmed + purged.confirmed > 0) logger.info("newsletter.purged", purged);
      return purged;
    },
    { connection: options.connection },
  );
  worker.on("failed", (job, error) => logger.error("newsletter.purge_failed", { jobId: job?.id, err: error }));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
