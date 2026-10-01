import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PublicUnsubscribeResponse } from "@impulza/contracts";
import { verifySequenceUnsubscribeToken, verifyUnsubscribeToken } from "@impulza/auth";
import type { Prisma, PrismaClient } from "@impulza/database";
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

/** A qué apunta un enlace de baja: un destinatario de campaña (F5.6) o una inscripción de secuencia (F7.5). */
type Target =
  | { kind: "campaign"; id: string; organizationId: string; organizationName: string; email: string; contactId: string | null; alreadyUnsubscribed: boolean; campaignId: string }
  | { kind: "sequence"; id: string; organizationId: string; organizationName: string; email: string; contactId: string; alreadyUnsubscribed: boolean; sequenceId: string };

/**
 * Baja de correos de marketing: campañas (F5.6) y secuencias (F7.5, ADR-020). Sin sesión; el enlace
 * firmado del correo es la credencial (cada tipo con su propio propósito de firma). Se respeta de
 * inmediato y para todo: el contacto queda con `marketing_unsubscribed_at`, sus secuencias en curso
 * se detienen y el worker vuelve a mirar esa marca justo antes de cada envío. Mismo 404 para un
 * enlace inválido o de algo que ya no existe.
 */
@Injectable()
export class PublicUnsubscribeService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  private async targetOrThrow(token: string): Promise<Target> {
    const secret = env.BOOKING_LINK_SECRET;
    if (!secret) throw new NotFoundException(UNSUBSCRIBE_NOT_FOUND);

    const recipientId = verifyUnsubscribeToken(token, secret);
    if (recipientId) {
      const recipient = await this.prisma.campaignRecipient.findUnique({
        where: { id: recipientId },
        include: {
          campaign: { select: { organization: { select: { name: true } } } },
          contact: { select: { id: true, marketingUnsubscribedAt: true } },
        },
      });
      if (recipient) {
        return {
          kind: "campaign",
          id: recipient.id,
          organizationId: recipient.organizationId,
          organizationName: recipient.campaign.organization.name,
          email: recipient.email,
          contactId: recipient.contact?.id ?? null,
          alreadyUnsubscribed: recipient.unsubscribedAt !== null || recipient.contact?.marketingUnsubscribedAt != null,
          campaignId: recipient.campaignId,
        };
      }
    }

    const enrollmentId = verifySequenceUnsubscribeToken(token, secret);
    if (enrollmentId) {
      const enrollment = await this.prisma.emailSequenceEnrollment.findUnique({
        where: { id: enrollmentId },
        include: { organization: { select: { name: true } }, contact: { select: { id: true, email: true, marketingUnsubscribedAt: true } } },
      });
      if (enrollment && enrollment.contact.email) {
        return {
          kind: "sequence",
          id: enrollment.id,
          organizationId: enrollment.organizationId,
          organizationName: enrollment.organization.name,
          email: enrollment.contact.email,
          contactId: enrollment.contact.id,
          alreadyUnsubscribed: enrollment.contact.marketingUnsubscribedAt !== null,
          sequenceId: enrollment.sequenceId,
        };
      }
    }
    throw new NotFoundException(UNSUBSCRIBE_NOT_FOUND);
  }

  async view(token: string): Promise<PublicUnsubscribeResponse> {
    const target = await this.targetOrThrow(token);
    return { organizationName: target.organizationName, maskedEmail: maskEmail(target.email), unsubscribed: target.alreadyUnsubscribed };
  }

  /** Idempotente: darse de baja dos veces no cambia nada ni falla. */
  async unsubscribe(token: string): Promise<PublicUnsubscribeResponse> {
    const target = await this.targetOrThrow(token);
    const now = new Date();
    const operations: Prisma.PrismaPromise<unknown>[] = [];
    if (target.kind === "campaign") {
      operations.push(this.prisma.campaignRecipient.updateMany({ where: { id: target.id, unsubscribedAt: null }, data: { unsubscribedAt: now } }));
    }
    if (target.contactId) {
      operations.push(
        this.prisma.contact.updateMany({ where: { id: target.contactId, marketingUnsubscribedAt: null }, data: { marketingUnsubscribedAt: now } }),
        // La baja es de todo el marketing: también se detienen sus secuencias en curso (F7.5).
        this.prisma.emailSequenceEnrollment.updateMany({
          where: { contactId: target.contactId, status: "ACTIVE" },
          data: { status: "STOPPED", stopReason: "unsubscribed", nextSendAt: null, finishedAt: now },
        }),
      );
    }
    await this.prisma.$transaction(operations);
    if (!target.alreadyUnsubscribed) {
      await this.auditService.record({
        organizationId: target.organizationId,
        actorId: null,
        action: "contact.marketing_unsubscribed",
        targetType: "Contact",
        targetId: target.contactId ?? target.id,
        metadata: target.kind === "campaign" ? { campaignId: target.campaignId } : { sequenceId: target.sequenceId },
      });
      logger.info("baja de correos de marketing", { organizationId: target.organizationId, via: target.kind });
    }
    return { organizationName: target.organizationName, maskedEmail: maskEmail(target.email), unsubscribed: true };
  }
}
