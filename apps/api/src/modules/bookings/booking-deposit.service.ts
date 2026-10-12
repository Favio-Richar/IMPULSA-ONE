import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { verifyBookingLinkToken } from "@impulza/auth";
import type { BookingWebpayStartResponse } from "@impulza/contracts";
import { PaymentGateway, type BookableService, type Booking, type PrismaClient } from "@impulza/database";
import {
  type CheckoutPayment,
  checkoutPaymentMismatches,
  checkoutSupportsCurrency,
  newWebpayPlusBuyOrder,
  PaymentGatewayError,
  verifyMercadoPagoSignature,
  type WebpayPlusLike,
  webpayPlusMismatches,
} from "@impulza/payments";
import { SERVED_SITE } from "../../common/active-organization.js";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { DISPUTE_STATUSES } from "../payment-accounts/checkout-refunds.service.js";
import { MERCADO_PAGO_CHECKOUT, WEBPAY_PLUS_GATEWAY, type CheckoutConfig } from "../payment-accounts/checkout.tokens.js";
import { PaymentAccountsService } from "../payment-accounts/payment-accounts.service.js";
import { BookingNotifier, bookingManageUrl } from "./booking-notifier.js";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service.js";
import { GoogleCalendarService } from "./google-calendar.service.js";

/** Plazo para pagar la seña. La hora queda tomada mientras tanto (nunca más allá del inicio). */
export const DEPOSIT_TTL_MS = 30 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_ID = /^\d{1,30}$/;
/** Los tokens de Webpay Plus son alfanuméricos largos; cualquier otra forma ni se consulta. */
const WEBPAY_TOKEN = /^[A-Za-z0-9]{20,100}$/;
const NOT_PAYABLE = "Esta reserva ya no espera la seña. Escríbele al negocio.";

function isOverlapViolation(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("bookings_no_overlap") || text.includes("23P01");
}

export type DepositSyncResult = "paid" | "paid_without_slot" | "updated" | "dispute" | "unchanged" | "mismatch" | "unavailable" | "rejected";

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
    @Inject(WEBPAY_PLUS_GATEWAY) private readonly webpay: WebpayPlusLike,
    private readonly accounts: PaymentAccountsService,
    private readonly notifier: BookingNotifier,
    private readonly audit: AuditService,
    private readonly googleCalendar: GoogleCalendarService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /**
   * ¿Este negocio puede cobrar señas ahora? La aplicación de Impulza configurada, las URLs públicas
   * (el comprador vuelve a "Tu reserva", que necesita el enlace firmado) y su cuenta conectada y sana.
   */
  async depositsEnabled(organizationId: string): Promise<boolean> {
    if (!env.API_PUBLIC_URL || !env.PUBLIC_SITE_BASE_URL || !env.BOOKING_LINK_SECRET) return false;
    // Bandera `pagos_en_linea` apagada: no se cobran señas (la reserva se confirma sin ellas).
    if (!(await this.flags.isEnabled("pagos_en_linea", organizationId))) return false;
    return (await this.providers(organizationId)).length > 0;
  }

  /** Medios con que este negocio puede cobrar la seña ahora (F10.2e): Mercado Pago y/o Webpay Plus, con su cuenta conectada. */
  async providers(organizationId: string): Promise<Array<"MERCADO_PAGO" | "WEBPAY_PLUS">> {
    const providers: Array<"MERCADO_PAGO" | "WEBPAY_PLUS"> = [];
    if (this.config && (await this.accounts.chargingAccountFor(organizationId))) providers.push("MERCADO_PAGO");
    if (await this.accounts.webpayPlusFor(organizationId)) providers.push("WEBPAY_PLUS");
    return providers;
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
   * Crea el cobro de la seña de una reserva recién tomada (`PENDING_PAYMENT`) con los medios que el negocio tiene
   * conectados: Mercado Pago (se crea la preferencia en el acto) y/o Webpay Plus (la transacción se crea cuando el
   * cliente pulsa «Pagar» en «Tu reserva», porque cada intento necesita la suya). Si ninguna pasarela puede, la reserva
   * se confirma sin seña: nunca se pierde una reserva por la pasarela.
   */
  async startFor(booking: Booking): Promise<{ booking: Booking; checkoutUrl: string | null; webpayUrl: string | null; gateways: Array<"MERCADO_PAGO" | "WEBPAY_PLUS"> }> {
    const manageUrl = bookingManageUrl(booking.id);
    const providers = await this.providers(booking.organizationId);
    const account = providers.includes("MERCADO_PAGO") ? await this.accounts.chargingAccountFor(booking.organizationId) : null;
    const canCharge = manageUrl && booking.depositAmount && booking.priceCurrency && booking.paymentDeadline;
    let preference: { id: string; checkoutUrl: string } | null = null;
    if (canCharge && account && this.config) {
      try {
        preference = await this.config.checkout.createPreference(
          account.accessToken,
          {
            externalReference: booking.id,
            title: `Seña: ${booking.serviceName}`,
            quantity: 1,
            unitPrice: booking.depositAmount!,
            currency: booking.priceCurrency!,
            payerEmail: booking.customerEmail,
            payerName: booking.customerName,
            notificationUrl: `${env.API_PUBLIC_URL!.replace(/\/+$/, "")}/api/v1/payments/mercadopago/bookings/${booking.id}/webhook`,
            backUrl: manageUrl!,
            expiresAt: booking.paymentDeadline!,
          },
          account.liveMode,
        );
      } catch (error) {
        logger.warn("reservas: no se pudo crear el cobro de la seña en Mercado Pago", {
          organizationId: booking.organizationId,
          bookingId: booking.id,
          code: error instanceof PaymentGatewayError ? error.code : "unknown",
        });
      }
    }
    const webpayConnected = canCharge ? providers.includes("WEBPAY_PLUS") : false;
    if (preference || webpayConnected) {
      const updated = preference
        ? await this.prisma.booking.update({
            where: { id: booking.id },
            data: { checkoutPreferenceId: preference.id, checkoutUrl: preference.checkoutUrl, paymentProvider: PaymentGateway.MERCADO_PAGO },
          })
        : booking;
      logger.info("reservas: seña creada", { organizationId: booking.organizationId, bookingId: booking.id, mercadoPago: preference !== null, webpay: webpayConnected });
      return {
        booking: updated,
        checkoutUrl: preference?.checkoutUrl ?? null,
        // El pago con Webpay se hace desde «Tu reserva»: ahí se crea la transacción en el momento de pagar.
        webpayUrl: webpayConnected ? manageUrl : null,
        gateways: [...(preference ? (["MERCADO_PAGO"] as const) : []), ...(webpayConnected ? (["WEBPAY_PLUS"] as const) : [])],
      };
    }
    const confirmed = await this.prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CONFIRMED", depositAmount: null, paymentDeadline: null },
    });
    return { booking: confirmed, checkoutUrl: null, webpayUrl: null, gateways: [] };
  }

  // ───────────────────────────── Webpay Plus (F10.2e, ADR-030) ─────────────────────────────

  private async bookingOfToken(token: string): Promise<Booking | null> {
    if (!token || token.length > 200 || !env.BOOKING_LINK_SECRET) return null;
    const bookingId = verifyBookingLinkToken(token, env.BOOKING_LINK_SECRET);
    if (!bookingId) return null;
    return this.prisma.booking.findFirst({ where: { id: bookingId, site: SERVED_SITE } });
  }

  private isPayable(booking: Booking, now = new Date()): boolean {
    return (
      booking.status === "PENDING_PAYMENT" &&
      booking.providerPaymentId === null &&
      booking.depositAmount !== null &&
      booking.depositAmount > 0 &&
      booking.priceCurrency !== null &&
      checkoutSupportsCurrency(booking.priceCurrency) &&
      booking.paymentDeadline !== null &&
      booking.paymentDeadline.getTime() > now.getTime()
    );
  }

  /** ¿Se puede pagar la seña ahora con Webpay? Lo usa «Tu reserva» para mostrar el botón. */
  async webpayAvailableFor(booking: Booking): Promise<boolean> {
    return this.isPayable(booking) && (await this.accounts.webpayPlusFor(booking.organizationId)) !== null;
  }

  /**
   * El cliente pulsa «Pagar con Webpay» en «Tu reserva»: se crea una transacción nueva a nombre del negocio por la seña
   * guardada (nunca un monto del visitante). La hora sigue tomada hasta el plazo; cada intento crea la suya y se confirma
   * la última al volver.
   */
  async startWebpay(token: string): Promise<BookingWebpayStartResponse> {
    const booking = await this.bookingOfToken(token);
    if (!booking) throw new NotFoundException("El enlace no es válido o la reserva ya no existe.");
    if (!env.API_PUBLIC_URL || !this.isPayable(booking)) throw new ConflictException(NOT_PAYABLE);
    const credentials = await this.accounts.webpayPlusFor(booking.organizationId);
    if (!credentials) throw new ServiceUnavailableException("El pago con Webpay no está disponible ahora. Escríbele al negocio.");

    const buyOrder = newWebpayPlusBuyOrder();
    const returnUrl = `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/api/v1/payments/webpay/bookings/${encodeURIComponent(token)}/return`;
    let transaction;
    try {
      transaction = await this.webpay.create(credentials, { buyOrder, sessionId: booking.id, amount: booking.depositAmount!, returnUrl });
    } catch (error) {
      logger.warn("reservas: no se pudo crear la transacción de Webpay", {
        organizationId: booking.organizationId,
        bookingId: booking.id,
        code: error instanceof PaymentGatewayError ? error.code : "unknown",
      });
      throw new ServiceUnavailableException("No pudimos iniciar el pago ahora. Intenta de nuevo en un momento.");
    }
    const saved = await this.prisma.booking.updateMany({
      where: { id: booking.id, providerPaymentId: null },
      data: { webpayToken: transaction.token, webpayBuyOrder: buyOrder, paymentProvider: PaymentGateway.WEBPAY_PLUS },
    });
    if (saved.count === 0) throw new ConflictException(NOT_PAYABLE);
    logger.info("reservas: transacción de seña creada en Webpay Plus", { organizationId: booking.organizationId, bookingId: booking.id });
    return { checkoutUrl: transaction.url, method: "POST", fields: { token_ws: transaction.token } };
  }

  /**
   * El cliente vuelve de Webpay con `token_ws` (pagó o lo intentó) o `TBK_TOKEN` (abandonó). El SERVIDOR confirma la
   * transacción que GUARDAMOS (nunca la de la URL) y solo aplica la seña si quedó autorizada y coinciden orden de compra y
   * monto. Devuelve a dónde mandar al cliente (siempre «Tu reserva»), o `null` si el enlace no corresponde a ninguna reserva.
   */
  async handleWebpayReturn(input: { token: string; tokenWs: string | undefined; tbkToken: string | undefined }): Promise<string | null> {
    const booking = await this.bookingOfToken(input.token);
    if (!booking || !env.PUBLIC_SITE_BASE_URL) return null;
    const manageUrl = `${env.PUBLIC_SITE_BASE_URL.replace(/\/+$/, "")}/reserva/${encodeURIComponent(input.token)}`;
    if (!input.tokenWs) return manageUrl;
    if (!WEBPAY_TOKEN.test(input.tokenWs) || input.tokenWs !== booking.webpayToken) {
      logger.warn("reservas: el token de Webpay no corresponde a la reserva", { organizationId: booking.organizationId, bookingId: booking.id });
      return manageUrl;
    }
    if (booking.providerPaymentId !== null) return manageUrl;
    try {
      await this.settleWebpay(booking);
    } catch (error) {
      logger.error("reservas: no se pudo confirmar la transacción de Webpay", { bookingId: booking.id, code: error instanceof PaymentGatewayError ? error.code : "unknown" });
    }
    return manageUrl;
  }

  private async settleWebpay(booking: Booking): Promise<DepositSyncResult> {
    const credentials = await this.accounts.webpayPlusFor(booking.organizationId);
    if (!credentials || !booking.webpayToken || !booking.webpayBuyOrder || booking.depositAmount === null) return "unavailable";
    let result;
    try {
      result = await this.webpay.commit(credentials, booking.webpayToken);
    } catch (error) {
      // Transbank solo admite confirmar una vez: si otra pasada ya la confirmó, se lee su estado en vez de fallar.
      if (error instanceof PaymentGatewayError && error.code === "rejected") {
        result = await this.webpay.status(credentials, booking.webpayToken);
      } else {
        throw error;
      }
    }
    const mismatches = webpayPlusMismatches(result, { buyOrder: booking.webpayBuyOrder, amount: booking.depositAmount });
    if (mismatches.length > 0) {
      if (result.status !== "AUTHORIZED" && mismatches.every((reason) => reason === "status" || reason === "response_code")) {
        await this.prisma.booking.updateMany({ where: { id: booking.id, providerPaymentId: null }, data: { paymentStatus: "rejected" } });
        return "rejected";
      }
      logger.warn("reservas: la transacción de Webpay no corresponde a la seña; no se aplica", { organizationId: booking.organizationId, bookingId: booking.id, mismatches });
      return "mismatch";
    }
    return this.applyApprovedDeposit(booking, `webpay:${result.buyOrder}`, result.transactionDate ?? new Date(), PaymentGateway.WEBPAY_PLUS);
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
    // La seña ya pagada cambió después (devolución, contracargo, reclamo): se registra lo que dice Mercado Pago.
    if (booking.providerPaymentId === payment.id) return this.applyPaymentChange(booking, payment);

    if (payment.status !== "approved") {
      if (booking.paymentStatus === payment.status) return "unchanged";
      await this.prisma.booking.updateMany({ where: { id: booking.id, providerPaymentId: null }, data: { paymentStatus: payment.status } });
      return "updated";
    }

    return this.applyApprovedDeposit(booking, payment.id, payment.approvedAt ?? new Date(), PaymentGateway.MERCADO_PAGO);
  }

  /**
   * Una seña aprobada y verificada (de la pasarela que sea) se asigna a la reserva, una sola vez: pendiente de seña (o
   * liberada con el plazo vencido) → confirmada si la hora sigue libre; si ya la tomó otra persona, se deja constancia y se
   * avisa al negocio; ya confirmada a mano → solo se guarda el pago.
   */
  private async applyApprovedDeposit(booking: Booking, paymentId: string, paidAt: Date, provider: PaymentGateway): Promise<DepositSyncResult> {
    const paymentData = { providerPaymentId: paymentId, paymentStatus: "approved", depositPaidAt: paidAt, paymentProvider: provider };
    const shownId = paymentId.startsWith("webpay:") ? paymentId.slice("webpay:".length) : paymentId;
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
            metadata: { provider, paymentId, afterExpiry: booking.status === "CANCELLED" },
          });
          await this.notifier.notifyDepositPaid(updated, siteName, shownId);
          this.googleCalendar.syncBookingById(booking.id, "CREATED");
          logger.info("reservas: seña confirmada", { organizationId: booking.organizationId, bookingId: booking.id, provider });
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
        metadata: { provider, paymentId },
      });
      await this.notifier.notifyOwners("paid_without_slot", claimed, siteName, shownId);
      logger.warn("reservas: pagaron la seña de una reserva que ya no estaba activa", { organizationId: booking.organizationId, bookingId: booking.id });
      return "paid_without_slot";
    }
    // El negocio ya la había confirmado o atendido a mano: se guarda el pago, sin avisos.
    return "updated";
  }

  /** Cambios de una seña ya pagada (F5.11a), con el mismo criterio que los pedidos. */
  private async applyPaymentChange(booking: Booking, payment: CheckoutPayment): Promise<DepositSyncResult> {
    if (booking.paymentStatus === payment.status && booking.depositRefundedAmount === payment.refundedAmount) return "unchanged";
    const changed = await this.prisma.booking.updateMany({
      where: { id: booking.id, providerPaymentId: payment.id, paymentStatus: booking.paymentStatus, depositRefundedAmount: booking.depositRefundedAmount },
      data: { paymentStatus: payment.status, depositRefundedAmount: Math.min(payment.refundedAmount, booking.depositAmount ?? 0) },
    });
    if (changed.count === 0) return "unchanged";
    if (DISPUTE_STATUSES.has(payment.status) && booking.paymentStatus !== payment.status) {
      await this.audit.record({
        organizationId: booking.organizationId,
        actorId: null,
        action: "booking.deposit_disputed",
        targetType: "Booking",
        targetId: booking.id,
        metadata: { paymentId: payment.id, status: payment.status },
      });
      const site = await this.prisma.site.findUnique({ where: { id: booking.siteId }, select: { name: true } });
      await this.notifier.notifyOwners(payment.status as "charged_back" | "in_mediation", booking, site?.name ?? "", payment.id);
      logger.warn("reservas: contracargo o reclamo de una seña en Mercado Pago", { organizationId: booking.organizationId, bookingId: booking.id, status: payment.status });
      return "dispute";
    }
    return "updated";
  }

  private async claimPayment(booking: Booking, data: { providerPaymentId: string; paymentStatus: string; depositPaidAt: Date; paymentProvider: PaymentGateway }): Promise<Booking | null> {
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
