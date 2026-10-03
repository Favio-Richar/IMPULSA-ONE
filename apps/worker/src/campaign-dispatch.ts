import { signUnsubscribeToken, type EmailAdapter } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { campaignEmail } from "@impulza/validation";
import { type ConnectionOptions, Queue, Worker } from "bullmq";
import { logger } from "./observability/logger.js";
import { brandOrganizationEmail } from "./brand.js";

export const CAMPAIGN_DISPATCH_QUEUE = "campaign-dispatch";
const HOUR = 3_600_000;
/** Correos por campaña y por pasada (la pasada corre cada minuto). */
const BATCH = 100;

export interface CampaignDispatchOptions {
  publicSiteBaseUrl?: string;
  linkSecret?: string;
  now?: Date;
}

/**
 * Despacha las campañas en envío (F5.6), sin pasarse del límite por hora que la API congeló al
 * iniciar el envío (el del plan). Cada destinatario se **reclama** con un `updateMany` condicional
 * (`PENDING → SENT`) antes de enviar: dos pasadas cruzadas nunca mandan dos veces el mismo correo;
 * si el envío falla queda `FAILED`. Justo antes de enviar se vuelve a mirar el contacto: si se dio
 * de baja (en esta u otra campaña) o ya no existe, queda `SKIPPED`. Sin URL pública o sin secreto
 * no se envía nada: todo correo de campaña lleva su enlace de baja.
 */
export async function dispatchCampaigns(prisma: PrismaClient, email: EmailAdapter, options: CampaignDispatchOptions = {}): Promise<number> {
  const now = options.now ?? new Date();
  const campaigns = await prisma.campaign.findMany({
    where: { status: "SENDING", organization: { status: "ACTIVE" } },
    include: { organization: { select: { name: true } } },
    orderBy: { sendStartedAt: "asc" },
  });
  if (campaigns.length === 0) {
    return 0;
  }
  if (!options.publicSiteBaseUrl || !options.linkSecret) {
    logger.error("campaign.dispatch.links_not_configured", { campaigns: campaigns.length });
    return 0;
  }
  const baseUrl = options.publicSiteBaseUrl.replace(/\/$/, "");

  let sent = 0;
  for (const campaign of campaigns) {
    let quota = BATCH;
    if (campaign.emailsPerHour !== null) {
      const lastHour = await prisma.campaignRecipient.count({
        where: { organizationId: campaign.organizationId, status: "SENT", sentAt: { gt: new Date(now.getTime() - HOUR) } },
      });
      quota = Math.min(BATCH, Math.max(0, campaign.emailsPerHour - lastHour));
    }
    if (quota > 0) {
      const pending = await prisma.campaignRecipient.findMany({
        where: { campaignId: campaign.id, status: "PENDING" },
        include: { contact: { select: { email: true, marketingConsentAt: true, marketingUnsubscribedAt: true } } },
        orderBy: { createdAt: "asc" },
        take: quota,
      });
      for (const recipient of pending) {
        const contact = recipient.contact;
        const stillWants = contact !== null && contact.email !== null && contact.marketingConsentAt !== null && contact.marketingUnsubscribedAt === null && recipient.unsubscribedAt === null;
        if (!stillWants) {
          await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "PENDING" }, data: { status: "SKIPPED", error: "Se dio de baja o ya no está en los contactos." } });
          continue;
        }
        const claimed = await prisma.campaignRecipient.updateMany({ where: { id: recipient.id, status: "PENDING" }, data: { status: "SENT", sentAt: now } });
        if (claimed.count !== 1) {
          continue;
        }
        const unsubscribeUrl = `${baseUrl}/baja/${signUnsubscribeToken(recipient.id, options.linkSecret)}`;
        const content = campaignEmail({ organizationName: campaign.organization.name, subject: campaign.subject, bodyHtml: campaign.bodyHtml, unsubscribeUrl });
        try {
          await email.send(await brandOrganizationEmail(prisma, campaign.organizationId, {
            to: recipient.email,
            subject: content.subject,
            text: content.text,
            html: content.html,
            // "Darse de baja" con un clic desde el cliente de correo (RFC 8058).
            headers: { "List-Unsubscribe": `<${baseUrl}/api/unsubscribe/${signUnsubscribeToken(recipient.id, options.linkSecret)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          }));
          sent += 1;
        } catch (error) {
          await prisma.campaignRecipient.update({ where: { id: recipient.id }, data: { status: "FAILED", sentAt: null, error: error instanceof Error ? error.message.slice(0, 300) : "Error al enviar." } });
          logger.error("campaign.recipient.failed", { campaignId: campaign.id, recipientId: recipient.id, err: error });
        }
      }
    }
    // Terminada: no queda nada pendiente (condicional, por si alguien la detuvo en el medio).
    const remaining = await prisma.campaignRecipient.count({ where: { campaignId: campaign.id, status: "PENDING" } });
    if (remaining === 0) {
      await prisma.campaign.updateMany({ where: { id: campaign.id, status: "SENDING" }, data: { status: "SENT", sentAt: now } });
      logger.info("campaign.sent", { campaignId: campaign.id, organizationId: campaign.organizationId });
    }
  }
  return sent;
}

export interface CampaignDispatchWorkers {
  close(): Promise<void>;
}

/** Revisa cada minuto las campañas en envío. */
export async function startCampaignDispatchWorkers(options: {
  prisma: PrismaClient;
  email: EmailAdapter;
  connection: ConnectionOptions;
  publicSiteBaseUrl?: string;
  linkSecret?: string;
}): Promise<CampaignDispatchWorkers> {
  const queue = new Queue(CAMPAIGN_DISPATCH_QUEUE, { connection: options.connection });
  await queue.upsertJobScheduler("campaign-dispatch-every-minute", { pattern: "0 * * * * *" }, { name: "dispatch-campaigns" });
  const worker = new Worker(
    CAMPAIGN_DISPATCH_QUEUE,
    async () => {
      const sent = await dispatchCampaigns(options.prisma, options.email, { publicSiteBaseUrl: options.publicSiteBaseUrl, linkSecret: options.linkSecret });
      if (sent > 0) {
        logger.info("campaign.dispatch.sent", { sent });
      }
      return sent;
    },
    // Una pasada a la vez: el reclamo por destinatario ya evita duplicados, esto evita trabajo doble.
    { connection: options.connection, concurrency: 1 },
  );
  worker.on("failed", (job, error) => logger.error("campaign.dispatch.failed", { jobId: job?.id, err: error }));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
