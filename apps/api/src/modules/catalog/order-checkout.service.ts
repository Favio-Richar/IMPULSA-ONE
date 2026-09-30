import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { PublicOrderStatusResponse } from "@impulza/contracts";
import type { Order, PrismaClient } from "@impulza/database";
import { type CheckoutPayment, checkoutPaymentMismatches, checkoutSupportsCurrency, PaymentGatewayError, verifyMercadoPagoSignature } from "@impulza/payments";
import { ACTIVE_ORGANIZATION } from "../../common/active-organization.js";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { PaymentAccountsService } from "../payment-accounts/payment-accounts.service.js";
import { DISPUTE_STATUSES } from "../payment-accounts/checkout-refunds.service.js";
import { MERCADO_PAGO_CHECKOUT, type CheckoutConfig } from "../payment-accounts/checkout.tokens.js";
import { downloadState, orderDownloadPageUrl } from "./download-access.js";
import { OrderNotifier } from "./order-notifier.js";
import { WebhookEventsService } from "../webhooks/webhook-events.service.js";

export const ORDER_STATUS_NOT_FOUND = "El enlace no es válido o el pedido ya no existe.";

/** Plazo para pagar un pedido en Mercado Pago. El stock queda reservado mientras tanto. */
const CHECKOUT_TTL_MS = 48 * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_ID = /^\d{1,30}$/;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type PaymentSyncResult = "paid" | "cancelled_paid" | "updated" | "dispute" | "unchanged" | "mismatch" | "unavailable";

/**
 * Cobro de pedidos con Checkout Pro (F5.9, ADR-013). Con la cuenta conectada del negocio, cada
 * pedido crea una preferencia **a nombre del negocio** (`external_reference` = pedido). La
 * confirmación nunca se toma del aviso ni del regreso del comprador: se consulta el pago en Mercado
 * Pago con el token del mismo negocio y solo se marca pagado si la cuenta receptora, el pedido, el
 * monto y la moneda coinciden. Marcar pagado es condicional (`NEW` y sin pago asignado): repetir un
 * aviso no tiene efecto.
 */
@Injectable()
export class OrderCheckoutService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(MERCADO_PAGO_CHECKOUT) private readonly config: CheckoutConfig | null,
    private readonly accounts: PaymentAccountsService,
    private readonly notifier: OrderNotifier,
    private readonly audit: AuditService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  private available(): boolean {
    return Boolean(this.config && env.API_PUBLIC_URL && env.PUBLIC_SITE_BASE_URL);
  }

  /**
   * Crea el cobro de un pedido recién hecho, si el negocio tiene cuenta conectada y la moneda se
   * puede cobrar. Si Mercado Pago falla, el pedido sigue como siempre (enlace externo o coordinar
   * con el negocio): nunca se pierde un pedido por un problema de la pasarela.
   */
  async startFor(order: Order): Promise<{ checkoutUrl: string; statusUrl: string } | null> {
    if (!this.available() || !checkoutSupportsCurrency(order.priceCurrency)) return null;
    const account = await this.accounts.chargingAccountFor(order.organizationId);
    if (!account) return null;

    const statusToken = randomBytes(32).toString("base64url");
    const statusUrl = `${env.PUBLIC_SITE_BASE_URL!.replace(/\/+$/, "")}/pedido/${statusToken}`;
    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
    let preference;
    try {
      preference = await this.config!.checkout.createPreference(
        account.accessToken,
        {
          externalReference: order.id,
          title: order.productName,
          quantity: order.quantity,
          unitPrice: order.unitPriceAmount,
          currency: order.priceCurrency,
          payerEmail: order.customerEmail,
          payerName: order.customerName,
          notificationUrl: `${env.API_PUBLIC_URL!.replace(/\/+$/, "")}/api/v1/payments/mercadopago/orders/${order.id}/webhook`,
          backUrl: statusUrl,
          expiresAt,
        },
        account.liveMode,
      );
    } catch (error) {
      logger.warn("pedidos: no se pudo crear el cobro en Mercado Pago; el pedido sigue sin cobro en línea", {
        organizationId: order.organizationId,
        orderId: order.id,
        code: error instanceof PaymentGatewayError ? error.code : "unknown",
      });
      return null;
    }
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        checkoutPreferenceId: preference.id,
        checkoutUrl: preference.checkoutUrl,
        checkoutExpiresAt: expiresAt,
        statusTokenHash: hashToken(statusToken),
      },
    });
    logger.info("pedidos: cobro creado en Mercado Pago", { organizationId: order.organizationId, orderId: order.id, liveMode: account.liveMode });
    return { checkoutUrl: preference.checkoutUrl, statusUrl };
  }

  /**
   * Aviso de Mercado Pago sobre un pago de un pedido. La firma se verifica antes de leer nada; el
   * pedido sale de la URL que pusimos en la preferencia. Siempre responde 200 a un aviso válido
   * (aunque no aplique) para que Mercado Pago no reintente sin fin.
   */
  async handleWebhook(input: { orderId: string; signature: string | undefined; requestId: string | undefined; dataId: string | undefined; type: string | undefined }): Promise<{ result: PaymentSyncResult | "ignored" }> {
    if (!this.config) throw new NotFoundException();
    if (!verifyMercadoPagoSignature({ signature: input.signature, requestId: input.requestId, dataId: input.dataId, secret: this.config.webhookSecret })) {
      logger.warn("pedidos: aviso de Mercado Pago con firma inválida", { type: input.type });
      throw new UnauthorizedException("Firma inválida.");
    }
    if (input.type !== "payment" || !input.dataId || !PAYMENT_ID.test(input.dataId) || !UUID.test(input.orderId)) {
      return { result: "ignored" };
    }
    const order = await this.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order || !order.checkoutPreferenceId) return { result: "ignored" };
    return { result: await this.syncPayment(order, input.dataId) };
  }

  /**
   * Consulta el pago con el token del negocio dueño del pedido y lo aplica si corresponde a ese
   * pedido. Idempotente: el mismo pago aplicado dos veces no cambia nada ni vuelve a avisar.
   */
  async syncPayment(order: Order, paymentId: string): Promise<PaymentSyncResult> {
    const account = await this.accounts.chargingAccountFor(order.organizationId);
    if (!account || !this.config) return "unavailable";
    let payment;
    try {
      payment = await this.config.checkout.getPayment(account.accessToken, paymentId);
    } catch (error) {
      const code = error instanceof PaymentGatewayError ? error.code : "unknown";
      logger.warn("pedidos: no se pudo consultar el pago en Mercado Pago", { organizationId: order.organizationId, orderId: order.id, code });
      // Un pago que el token del negocio no ve es de otra cuenta: no aplica a este pedido.
      if (code === "not_found") return "mismatch";
      throw error;
    }

    const mismatches = checkoutPaymentMismatches(payment, {
      externalReference: order.id,
      collectorId: account.providerUserId,
      amount: order.totalAmount,
      currency: order.priceCurrency,
    });
    if (mismatches.length > 0) {
      logger.warn("pedidos: el pago de Mercado Pago no corresponde al pedido; no se aplica", { organizationId: order.organizationId, orderId: order.id, mismatches });
      return "mismatch";
    }

    // El pedido ya lo pagó otro pago: este no cambia nada.
    if (order.providerPaymentId !== null && order.providerPaymentId !== payment.id) return "unchanged";
    // El pago del pedido cambió después (devolución, contracargo, reclamo): se registra lo que dice Mercado Pago.
    if (order.providerPaymentId === payment.id) return this.applyPaymentChange(order, payment);

    if (payment.status !== "approved") {
      if (order.paymentStatus === payment.status) return "unchanged";
      await this.prisma.order.updateMany({ where: { id: order.id, providerPaymentId: null }, data: { paymentStatus: payment.status } });
      return "updated";
    }

    const site = await this.prisma.site.findUnique({ where: { id: order.siteId }, select: { name: true } });
    if (order.status === "CANCELLED") {
      // Pagaron un pedido cancelado: se deja constancia y se avisa al negocio (reactivar o devolver).
      const claimed = await this.claimPayment(order, payment.id, {});
      if (!claimed) return "unchanged";
      await this.audit.record({ organizationId: order.organizationId, actorId: null, action: "order.cancelled_order_paid", targetType: "Order", targetId: order.id, metadata: { paymentId: payment.id } });
      await this.notifier.notifyCancelledOrderPaid(claimed, site?.name ?? "", payment.id);
      logger.warn("pedidos: pagaron un pedido cancelado", { organizationId: order.organizationId, orderId: order.id });
      return "cancelled_paid";
    }
    if (order.status !== "NEW") {
      // El negocio ya lo había marcado pagado o entregado a mano: se guarda el pago, sin avisos.
      return (await this.claimPayment(order, payment.id, {})) ? "updated" : "unchanged";
    }

    const paid = await this.claimPayment(order, payment.id, { status: "PAID", paidAt: payment.approvedAt ?? new Date() }, "NEW");
    if (!paid) return "unchanged";
    await this.audit.record({ organizationId: order.organizationId, actorId: null, action: "order.paid_online", targetType: "Order", targetId: order.id, metadata: { provider: "MERCADO_PAGO", paymentId: payment.id } });
    await this.notifier.notifyPaidOnline(paid, site?.name ?? "", payment.id);
    await this.webhookEvents.emit({ organizationId: order.organizationId, type: "order.paid", subjectId: order.id });
    logger.info("pedidos: pago confirmado por Mercado Pago", { organizationId: order.organizationId, orderId: order.id });
    return "paid";
  }

  /**
   * Cambios de un pago ya asignado (F5.11a): lo devuelto y el estado vienen de Mercado Pago. Un
   * contracargo o un reclamo se audita y se avisa al negocio una sola vez (la actualización es
   * condicional al estado leído).
   */
  private async applyPaymentChange(order: Order, payment: CheckoutPayment): Promise<PaymentSyncResult> {
    if (order.paymentStatus === payment.status && order.refundedAmount === payment.refundedAmount) return "unchanged";
    const changed = await this.prisma.order.updateMany({
      where: { id: order.id, providerPaymentId: payment.id, paymentStatus: order.paymentStatus, refundedAmount: order.refundedAmount },
      data: { paymentStatus: payment.status, refundedAmount: Math.min(payment.refundedAmount, order.totalAmount) },
    });
    if (changed.count === 0) return "unchanged";
    if (DISPUTE_STATUSES.has(payment.status) && order.paymentStatus !== payment.status) {
      await this.audit.record({ organizationId: order.organizationId, actorId: null, action: "order.payment_disputed", targetType: "Order", targetId: order.id, metadata: { paymentId: payment.id, status: payment.status } });
      const site = await this.prisma.site.findUnique({ where: { id: order.siteId }, select: { name: true } });
      await this.notifier.notifyDispute(order, site?.name ?? "", payment.id, payment.status as "charged_back" | "in_mediation");
      logger.warn("pedidos: contracargo o reclamo en Mercado Pago", { organizationId: order.organizationId, orderId: order.id, status: payment.status });
      return "dispute";
    }
    return "updated";
  }

  /** Asigna el pago al pedido si todavía no tiene uno (y, si se pide, si sigue en `expectedStatus`). */
  private async claimPayment(order: Order, paymentId: string, data: { status?: "PAID"; paidAt?: Date }, expectedStatus?: "NEW"): Promise<Order | null> {
    try {
      const result = await this.prisma.order.updateMany({
        where: { id: order.id, providerPaymentId: null, ...(expectedStatus ? { status: expectedStatus } : {}) },
        data: { ...data, providerPaymentId: paymentId, paymentStatus: "approved" },
      });
      if (result.count === 0) return null;
    } catch (error) {
      // El mismo pago ya está en otro pedido: imposible si `external_reference` coincide, pero nunca se duplica.
      if (isUniqueViolation(error)) return null;
      throw error;
    }
    return this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  }

  /**
   * "Tu pedido": con el enlace del correo o al volver de Mercado Pago. Si vuelve con `payment_id`
   * y el pedido espera pago, se consulta ese pago en el momento (no se espera el aviso); lo que
   * diga la URL del regreso nunca se usa como verdad.
   */
  async publicStatus(token: string, returnedPaymentId?: string): Promise<PublicOrderStatusResponse> {
    if (!token || token.length > 100) throw new NotFoundException(ORDER_STATUS_NOT_FOUND);
    let order = await this.prisma.order.findFirst({
      where: { statusTokenHash: hashToken(token), site: { status: { not: "ARCHIVED" }, ...ACTIVE_ORGANIZATION } },
    });
    if (!order) throw new NotFoundException(ORDER_STATUS_NOT_FOUND);

    if (returnedPaymentId && PAYMENT_ID.test(returnedPaymentId) && order.providerPaymentId === null) {
      try {
        const result = await this.syncPayment(order, returnedPaymentId);
        if (result !== "unchanged" && result !== "mismatch" && result !== "unavailable") {
          order = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        }
      } catch {
        // Mercado Pago no respondió: se muestra el último estado conocido; el aviso llegará igual.
      }
    }
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: order.siteId }, select: { slug: true, name: true } });
    // Archivo comprado (F5.11b): el enlace se muestra cuando el pedido ya lo entrega (o agotó sus
    // descargas: la página lo explica).
    const file = order.productKind === "DIGITAL" && order.productId
      ? await this.prisma.productFile.findFirst({ where: { productId: order.productId, status: "READY" }, select: { id: true } })
      : null;
    const delivery = downloadState(order, file !== null);
    const downloadUrl = delivery === "ready" || delivery === "limit_reached" ? orderDownloadPageUrl(order.id) : null;
    const canPay = order.status === "NEW" && order.paymentStatus !== "approved" && order.checkoutUrl !== null && (order.checkoutExpiresAt?.getTime() ?? 0) > Date.now();
    return {
      siteSlug: site.slug,
      siteName: site.name,
      productName: order.productName,
      quantity: order.quantity,
      totalAmount: order.totalAmount,
      priceCurrency: order.priceCurrency,
      status: order.status,
      paymentStatus: order.paymentStatus,
      checkoutUrl: canPay ? order.checkoutUrl : null,
      downloadUrl,
    };
  }
}
