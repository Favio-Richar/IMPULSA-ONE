import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PublicUnsubscribeResponse } from "@impulza/contracts";
import { verifyUnsubscribeToken } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";

export const UNSUBSCRIBE_NOT_FOUND = "Enlace no válido.";

/** "an•••@ejemplo.cl": confirma a quién sin mostrar el correo entero a quien tenga el enlace. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`;
}

/**
 * Baja de campañas (F5.6): sin sesión; el enlace firmado del correo es la credencial. Se respeta de
 * inmediato: el contacto queda con `marketing_unsubscribed_at` y el worker comprueba esa marca
 * justo antes de cada envío, así que tampoco le llega lo que quedaba en cola de otra campaña.
 * Mismo 404 para un enlace inválido o de un destinatario que ya no existe.
 */
@Injectable()
export class PublicUnsubscribeService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  private async recipientOrThrow(token: string) {
    const recipientId = env.BOOKING_LINK_SECRET ? verifyUnsubscribeToken(token, env.BOOKING_LINK_SECRET) : null;
    if (!recipientId) {
      throw new NotFoundException(UNSUBSCRIBE_NOT_FOUND);
    }
    const recipient = await this.prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      include: {
        campaign: { select: { organization: { select: { name: true } } } },
        contact: { select: { id: true, marketingUnsubscribedAt: true } },
      },
    });
    if (!recipient) {
      throw new NotFoundException(UNSUBSCRIBE_NOT_FOUND);
    }
    return recipient;
  }

  async view(token: string): Promise<PublicUnsubscribeResponse> {
    const recipient = await this.recipientOrThrow(token);
    return {
      organizationName: recipient.campaign.organization.name,
      maskedEmail: maskEmail(recipient.email),
      unsubscribed: recipient.unsubscribedAt !== null || recipient.contact?.marketingUnsubscribedAt != null,
    };
  }

  /** Idempotente: darse de baja dos veces no cambia nada ni falla. */
  async unsubscribe(token: string): Promise<PublicUnsubscribeResponse> {
    const recipient = await this.recipientOrThrow(token);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.campaignRecipient.updateMany({ where: { id: recipient.id, unsubscribedAt: null }, data: { unsubscribedAt: now } }),
      ...(recipient.contact
        ? [this.prisma.contact.updateMany({ where: { id: recipient.contact.id, marketingUnsubscribedAt: null }, data: { marketingUnsubscribedAt: now } })]
        : []),
    ]);
    if (recipient.unsubscribedAt === null) {
      await this.auditService.record({
        organizationId: recipient.organizationId,
        actorId: null,
        action: "contact.marketing_unsubscribed",
        targetType: "Contact",
        targetId: recipient.contactId ?? recipient.id,
        metadata: { campaignId: recipient.campaignId },
      });
      logger.info("baja de campañas", { organizationId: recipient.organizationId, campaignId: recipient.campaignId });
    }
    return { organizationName: recipient.campaign.organization.name, maskedEmail: maskEmail(recipient.email), unsubscribed: true };
  }
}
