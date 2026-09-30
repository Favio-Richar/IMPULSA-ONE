import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { BookableService, Booking, PrismaClient } from "@impulza/database";
import { checkoutPaymentMismatches, checkoutSupportsCurrency, PaymentGatewayError, verifyMercadoPagoSignature } from "@impulza/payments";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { MERCADO_PAGO_CHECKOUT, type CheckoutConfig } from "../payment-accounts/checkout.tokens.js";
import { PaymentAccountsService } from "../payment-accounts/payment-accounts.service.js";
import { BookingNotifier, bookingManageUrl } from "./booking-notifier.js";

/** Plazo para pagar la seña. La hora queda tomada mientras tanto (nunca más allá del inicio). */
export const DEPOSIT_TTL_MS = 30 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_ID = /^\d{1,30}$/;

function isOverlapViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("bookings_no_overlap") || text.includes("23P01");
}

export type DepositSyncResult = "paid" | "paid_without_slot" | "updated" | "unchanged" | "mismatch" | "unavailable";

export interface DepositPlan {
  depositAmount: number;
  paymentDeadline: Date;
}

/**
 * Seña de reservas (F5.10, ADR-013), con el mismo criterio que el cobro de pedidos (F5.9): la
 * preferencia se crea con el token del negocio (`external_reference` = reserva), el aviso vale solo
 * con la firma de la aplicación de Impulza y el pago se consulta en Mercado Pago con el token del
 * mismo negocio. La reserva pasa a confirmada solo si el pago es de esa reserva, llegó a la cuenta
 * del negocio y por el monto y moneda exactos de la seña; asignarlo es condicional (idempotente).
 */
@Injectable()
export class BookingDepositService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(MERCADO_PAGO_CHECKOUT) private readonly config: CheckoutConfig | null,
    private readonly accounts: PaymentAccountsService,
    private readonly notifier: BookingNotifier,
    private readonly audit: AuditService,
  ) {}

  /**
   * ¿Este negocio puede cobrar señas ahora? La aplicación de Impulza configurada, las URLs públicas
   * (el comprador vuelve a "Tu reserva", que necesita el enlace firmado) y su cuenta conectada y sana.
   */
  async depositsEnabled(organizationId: string): Promise<boolean> {
    if (!this.config || !env.API_PUBLIC_URL || !env.PUBLIC_SITE_BASE_URL || !env.BOOKING_LINK_SECRET) return false;
    return (await this.accounts.chargingAccountFor(organizationId)) !== null;
  }

  /** La seña que se cobra por un servicio, o `null` (sin seña, o en una moneda que no se cobra en línea). */
  depositOf(service: Pick<BookableService, "depositAmount" | "priceCurrency">, enabled: boolean): number | null {
    return enabled && service.depositAmount && service.priceCurrency && checkoutSupportsCurrency(service.priceCurrency) ? service.depositAmount : null;
  }

  /** Antes de crear la reserva: si se cobrará seña, cuánto y hasta cuándo se puede pagar. */
  async planFor(organizationId: string, service: BookableService, startsAt: Date, now: Date): Promise<DepositPlan | null> {
    if (!service.depositAmount) return null;
    const depositAmount = this.depositOf(service, await this.depositsEnabled(organizationId));
    if (depositAmount === null) return null;
    return { depositAmount, paymentDeadline: new Date(Math.min(now.getTime() + DEPOSIT_TTL_MS, startsAt.getTime())) };
  }

  /**
   * Crea el cobro de la seña de una reserva recién tomada (`PENDING_PAYMENT`). Si Mercado Pago o la
   * cuenta fallan, la reserva se confirma sin seña: nunca se pierde una reserva por la pasarela.
   */
  async startFor(booking: Booking): Promise<{ booking: Booking; checkoutUrl: string | null }> {
    const account = await this.accounts.chargingAccountFor(booking.organizationId);
    const manageUrl = bookingManageUrl(booking.id);
    if (account && this.config && manageUrl && booking.depositAmount && booking.priceCurrency && booking.paymentDeadline) {
      try {
        const preference = await this.config.checkout.createPreference(
          account.accessToken,
          {
            externalReference: booking.id,
            title: `Seña: ${booking.serviceName}`,
            quantity: 1,
            unitPrice: booking.depositAmount,
            currency: booking.priceCurrency,
            payerEmail: booking.customerEmail,
            payerName: booking.customerName,
            notificationUrl: `${env.API_PUBLIC_URL!.replace(/\/+$/, "")}/api/v1/payments/mercadopago/bookings/${booking.id}/webhook`,
            backUrl: manageUrl,
            expiresAt: booking.paymentDeadline,
          },
          account.liveMode,
        );
        const updated = await this.prisma.booking.update({
          where: { id: booking.id },
          data: { checkoutPreferenceId: preference.id, checkoutUrl: preference.checkoutUrl },
        });
        logger.info("reservas: seña creada en Mercado Pago", { organizationId: booking.organizationId, bookingId: booking.id, liveMode: account.liveMode });
        return { booking: updated, checkoutUrl: preference.checkoutUrl };
      } catch (error) {
        logger.warn("reservas: no se pudo crear el cobro de la seña; la reserva se confirma sin seña", {
          organizationId: booking.organizationId,
          bookingId: booking.id,
          code: error instanceof PaymentGatewayError ? error.code : "unknown",
        });
      }
    }
    const confirmed = await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CONFIRMED", depositAmount: null, paymentDeadline: null },
    });
    return { booking: confirmed, checkoutUrl: null };
  }

  /** Aviso de Mercado Pago sobre la seña de una reserva. Firma primero; siempre 200 a un aviso válido. */
  async handleWebhook(input: { bookingId: string; signature: string | undefined; requestId: string | undefined; dataId: string | undefined; type: string | undefined }): Promise<{ result: DepositSyncResult | "ignored" }> {
    if (!this.config) throw new NotFoundException();
    if (!verifyMercadoPagoSignature({ signature: input.signature, requestId: input.requestId, dataId: input.dataId, secret: this.config.webhookSecret })) {
      logger.warn("reservas: aviso de Mercado Pago con firma inválida", { type: input.type });
      throw new UnauthorizedException("Firma inválida.");
    }
    if (input.type !== "payment" || !input.dataId || !PAYMENT_ID.test(input.dataId) || !UUID.test(input.bookingId)) {
      return { result: "ignored" };
    }
    const booking = await this.prisma.booking.findUnique({ where: { id: input.bookingId } });
    if (!booking || !booking.checkoutPreferenceId) return { result: "ignored" };
    return { result: await this.syncPayment(booking, input.dataId) };
  }

  /**
   * Consulta el pago con el token del negocio dueño de la reserva y lo aplica. Si la hora ya se
   * había liberado por falta de pago y sigue libre, la reserva se reconfirma; si la tomó otra
   * persona (o el negocio la canceló), queda como está y se avisa al negocio para que resuelva.
   */
  async syncPayment(booking: Booking, paymentId: string): Promise<DepositSyncResult> {
    const account = await this.accounts.chargingAccountFor(booking.organizationId);
    if (!account || !this.config || booking.depositAmount === null || !booking.priceCurrency) return "unavailable";
    let payment;
    try {
      payment = await this.config.checkout.getPayment(account.accessToken, paymentId);
    } catch (error) {
      const code = error instanceof PaymentGatewayError ? error.code : "unknown";
      logger.warn("reservas: no se pudo consultar el pago de la seña", { organizationId: booking.organizationId, bookingId: booking.id, code });
      if (code === "not_found") return "mismatch";
      throw error;
    }
    const mismatches = checkoutPaymentMismatches(payment, {
      externalReference: booking.id,
      collectorId: account.providerUserId,
      amount: booking.depositAmount,
      currency: booking.priceCurrency,
    });
    if (mismatches.length > 0) {
      logger.warn("reservas: el pago no corresponde a la seña; no se aplica", { organizationId: booking.organizationId, bookingId: booking.id, mismatches });
      return "mismatch";
    }
    if (booking.providerPaymentId !== null && booking.providerPaymentId !== payment.id) return "unchanged";

    if (payment.status !== "approved") {
      if (booking.providerPaymentId === payment.id || booking.paymentStatus === payment.status) return "unchanged";
      await this.prisma.booking.updateMany({ where: { id: booking.id, providerPaymentId: null }, data: { paymentStatus: payment.status } });
      return "updated";
    }
    if (booking.providerPaymentId === payment.id) return "unchanged";

    const paidAt = payment.approvedAt ?? new Date();
    const paymentData = { providerPaymentId: payment.id, paymentStatus: "approved", depositPaidAt: paidAt };
    const site = await this.prisma.site.findUnique({ where: { id: booking.siteId }, select: { name: true } });
    const siteName = site?.name ?? "";

    // Esperando seña, o liberada por el worker con el plazo vencido: se confirma (si la hora sigue libre).
    const confirmable = booking.status === "PENDING_PAYMENT" || (booking.status === "CANCELLED" && booking.paymentExpiredAt !== null);
    if (confirmable) {
      try {
        const confirmed = await this.prisma.booking.updateMany({
          where: { id: booking.id, status: booking.status, providerPaymentId: null },
          data: { ...paymentData, status: "CONFIRMED", cancelledAt: null },
        });
        if (confirmed.count === 1) {
          const updated = await this.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
          await this.audit.record({
            organizationId: booking.organizationId,
            actorId: null,
            action: "booking.deposit_paid",
            targetType: "Booking",
            targetId: booking.id,
            metadata: { provider: "MERCADO_PAGO", paymentId: payment.id, afterExpiry: booking.status === "CANCELLED" },
          });
          await this.notifier.notifyDepositPaid(updated, siteName, payment.id);
          logger.info("reservas: seña confirmada por Mercado Pago", { organizationId: booking.organizationId, bookingId: booking.id });
          return "paid";
        }
        return "unchanged";
      } catch (error) {
        if (isUniqueViolation(error)) return "unchanged";
        // La hora liberada ya la tomó otra persona: se deja constancia del pago y se avisa abajo.
        if (!isOverlapViolation(error)) throw error;
      }
    }

    const claimed = await this.claimPayment(booking, paymentData);
    if (!claimed) return "unchanged";
    if (booking.status === "CANCELLED") {
      await this.audit.record({
        organizationId: booking.organizationId,
        actorId: null,
        action: "booking.deposit_paid_without_slot",
        targetType: "Booking",
        targetId: booking.id,
        metadata: { paymentId: payment.id },
      });
      await this.notifier.notifyOwners("paid_without_slot", claimed, siteName, payment.id);
      logger.warn("reservas: pagaron la seña de una reserva que ya no estaba activa", { organizationId: booking.organizationId, bookingId: booking.id });
      return "paid_without_slot";
    }
    // El negocio ya la había confirmado o atendido a mano: se guarda el pago, sin avisos.
    return "updated";
  }

  private async claimPayment(booking: Booking, data: { providerPaymentId: string; paymentStatus: string; depositPaidAt: Date }): Promise<Booking | null> {
    try {
      const result = await this.prisma.booking.updateMany({ where: { id: booking.id, providerPaymentId: null }, data });
      if (result.count === 0) return null;
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
    return this.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  }
}
