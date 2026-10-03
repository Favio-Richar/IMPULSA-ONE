import { Inject, Injectable } from "@nestjs/common";
import { signBookingLinkToken, type EmailAdapter } from "@impulza/auth";
import type { Booking, PrismaClient } from "@impulza/database";
import {
  bookingCancelledEmail,
  bookingConfirmationEmail,
  bookingDepositPaidEmail,
  bookingDepositRefundedEmail,
  bookingDepositPendingEmail,
  formatDepositAmount,
  bookingRescheduledEmail,
  ownerBookingNoticeEmail,
  type BookingMessageData,
  type EmailContent,
  type OwnerNoticeKind,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { BrandProfileService } from "../brand-profile/brand-profile.service.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

export type CustomerNoticeKind = "confirmed" | "rescheduled" | "cancelled";

/** Enlace "gestiona tu reserva", o `null` si la instalación no tiene URL pública o secreto. */
export function bookingManageUrl(bookingId: string): string | null {
  if (!env.PUBLIC_SITE_BASE_URL || !env.BOOKING_LINK_SECRET) {
    return null;
  }
  return `${env.PUBLIC_SITE_BASE_URL.replace(/\/$/, "")}/reserva/${signBookingLinkToken(bookingId, env.BOOKING_LINK_SECRET)}`;
}

/**
 * Correos de reservas (F5.4): al cliente (confirmación, cambio de hora, cancelación) y a los
 * dueños del negocio. Nunca hacen fallar la operación que los dispara: una reserva confirmada no se
 * deshace porque el proveedor de correo falle; se registra y se sigue.
 */
@Injectable()
export class BookingNotifier {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly brandProfileService: BrandProfileService,
  ) {}

  private async send(to: string, content: EmailContent, context: Record<string, unknown>): Promise<void> {
    try {
      const message = { to, subject: content.subject, text: content.text };
      // F9.2: lo que el negocio envía a SUS clientes lleva la marca del negocio; los avisos a los dueños no.
      const organizationId = context.to === "customer" ? context.organizationId : undefined;
      await this.email.send(typeof organizationId === "string" ? await this.brandProfileService.brandEmail(organizationId, message) : message);
    } catch (error) {
      logger.error("no se pudo enviar un correo de reserva", { ...context, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private messageData(booking: Booking, siteName: string): BookingMessageData {
    return {
      siteName,
      serviceName: booking.serviceName,
      startsAt: booking.startsAt.toISOString(),
      timeZone: booking.timeZone,
      priceAmount: booking.priceAmount,
      priceCurrency: booking.priceCurrency,
      paymentUrl: booking.paymentUrl,
      manageUrl: bookingManageUrl(booking.id),
      depositAmount: booking.depositAmount,
    };
  }

  /** La reserva espera la seña (F5.10): se le pide pagarla antes del plazo. */
  async notifyDepositPending(booking: Booking, siteName: string): Promise<void> {
    if (!booking.paymentDeadline) return;
    await this.send(booking.customerEmail, bookingDepositPendingEmail(this.messageData(booking, siteName), booking.paymentDeadline.toISOString()), {
      bookingId: booking.id,
      kind: "deposit_pending",
      to: "customer",
      organizationId: booking.organizationId,
    });
  }

  /** El negocio devolvió la seña (F5.11a): aviso al cliente. */
  async notifyDepositRefunded(booking: Booking, siteName: string, amount: number): Promise<void> {
    await this.send(booking.customerEmail, bookingDepositRefundedEmail(this.messageData(booking, siteName), amount), { bookingId: booking.id, kind: "deposit_refunded", to: "customer", organizationId: booking.organizationId });
  }

  /** Mercado Pago confirmó la seña: al cliente (reserva confirmada) y a los dueños (nueva reserva con seña). */
  async notifyDepositPaid(booking: Booking, siteName: string, paymentId: string): Promise<void> {
    await this.send(booking.customerEmail, bookingDepositPaidEmail(this.messageData(booking, siteName)), { bookingId: booking.id, kind: "deposit_paid", to: "customer", organizationId: booking.organizationId });
    await this.notifyOwners("deposit_paid", booking, siteName, paymentId);
  }

  async notifyCustomer(kind: CustomerNoticeKind, booking: Booking, siteName: string): Promise<void> {
    const data = this.messageData(booking, siteName);
    const content = kind === "confirmed" ? bookingConfirmationEmail(data) : kind === "rescheduled" ? bookingRescheduledEmail(data) : bookingCancelledEmail(data);
    await this.send(booking.customerEmail, content, { bookingId: booking.id, kind, to: "customer", organizationId: booking.organizationId });
  }

  /** Aviso a los dueños activos de la organización. */
  async notifyOwners(kind: OwnerNoticeKind, booking: Booking, siteName: string, paymentId?: string): Promise<void> {
    const owners = await this.prisma.membership.findMany({
      where: { organizationId: booking.organizationId, status: "ACTIVE", role: { name: "OWNER" } },
      select: { user: { select: { email: true } } },
    });
    const content = ownerBookingNoticeEmail({
      kind,
      siteName,
      serviceName: booking.serviceName,
      startsAt: booking.startsAt.toISOString(),
      timeZone: booking.timeZone,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerPhone: booking.customerPhone,
      note: booking.note,
      agendaUrl: `${env.APP_BASE_URL.replace(/\/$/, "")}/reservas`,
      deposit:
        paymentId && booking.depositAmount !== null && booking.priceCurrency
          ? { amount: formatDepositAmount(booking.depositAmount, booking.priceCurrency), paymentId }
          : null,
    });
    for (const owner of owners) {
      await this.send(owner.user.email, content, { bookingId: booking.id, kind, to: "owner" });
    }
  }
}
