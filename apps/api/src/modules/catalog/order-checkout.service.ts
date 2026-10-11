import { createHash, randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { OrderWebpayStartResponse, PublicOrderStatusResponse } from "@impulza/contracts";
import { PaymentGateway, type Order, type PrismaClient } from "@impulza/database";
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
import { PaymentAccountsService } from "../payment-accounts/payment-accounts.service.js";
import { DISPUTE_STATUSES } from "../payment-accounts/checkout-refunds.service.js";
import { MERCADO_PAGO_CHECKOUT, WEBPAY_PLUS_GATEWAY, type CheckoutConfig } from "../payment-accounts/checkout.tokens.js";
import { downloadState, orderDownloadPageUrl } from "./download-access.js";
import { OrderNotifier } from "./order-notifier.js";
import { WebhookEventsService } from "../webhooks/webhook-events.service.js";

export const ORDER_STATUS_NOT_FOUND = "El enlace no es válido o el pedido ya no existe.";

/** Plazo para pagar un pedido en Mercado Pago. El stock queda reservado mientras tanto. */
const CHECKOUT_TTL_MS = 48 * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_ID = /^\d{1,30}$/;
/** Los tokens de Webpay Plus son alfanuméricos largos; cualquier otra forma ni se consulta. */
const WEBPAY_TOKEN = /^[A-Za-z0-9]{20,100}$/;
const NOT_PAYABLE = "Este pedido ya no se puede pagar en línea. Escríbele al negocio.";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type PaymentSyncResult = "paid" | "cancelled_paid" | "updated" | "dispute" | "unchanged" | "mismatch" | "unavailable" | "rejected";

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
    @Inject(WEBPAY_PLUS_GATEWAY) private readonly webpay: WebpayPlusLike,
    private readonly accounts: PaymentAccountsService,
    private readonly notifier: OrderNotifier,
    private readonly audit: AuditService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  private urlsConfigured(): boolean {
    return Boolean(env.API_PUBLIC_URL && env.PUBLIC_SITE_BASE_URL);
  }

  /**
   * Crea el cobro de un pedido recién hecho con los medios que el negocio tiene conectados y la moneda permite: Mercado Pago (se crea la
   * preferencia en el acto) y/o Webpay Plus (la transacción se crea cuando el comprador pulsa «Pagar», porque cada intento necesita la
   * suya). Si la pasarela falla, el pedido sigue como siempre (enlace externo o coordinar con el negocio): nunca se pierde un pedido.
   */
  async startFor(order: Order): Promise<{ checkoutUrl: string | null; webpayUrl: string | null; statusUrl: string } | null> {
    if (!this.urlsConfigured() || !checkoutSupportsCurrency(order.priceCurrency)) return null;
    // Un pedido gratis (cupón del 100 %, F7.8b) no tiene nada que cobrar.
    if (order.totalAmount <= 0) return null;
    const account = this.config ? await this.accounts.chargingAccountFor(order.organizationId) : null;
    const webpayConnected = (await this.accounts.webpayPlusFor(order.organizationId)) !== null;
    if (!account && !webpayConnected) return null;

    const statusToken = randomBytes(32).toString("base64url");
    const statusUrl = `${env.PUBLIC_SITE_BASE_URL!.replace(/\/+$/, "")}/pedido/${statusToken}`;
    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
    // Con descuento (o varias líneas, F7.8c), Mercado Pago cobra un solo ítem por el total: la suma
    // de los ítems tiene que ser exactamente `total_amount`, que es lo que se verifica al confirmar.
    const itemized = order.unitPriceAmount * order.quantity === order.totalAmount;
    let preference: { id: string; checkoutUrl: string } | null = null;
    if (account) {
      try {
        preference = await this.config!.checkout.createPreference(
          account.accessToken,
          {
            externalReference: order.id,
            title: itemized || !order.couponCode ? order.productName : `${order.productName} (cupón ${order.couponCode})`,
            quantity: itemized ? order.quantity : 1,
            unitPrice: itemized ? order.unitPriceAmount : order.totalAmount,
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
        logger.warn("pedidos: no se pudo crear el cobro en Mercado Pago", {
          organizationId: order.organizationId,
          orderId: order.id,
          code: error instanceof PaymentGatewayError ? error.code : "unknown",
        });
      }
    }
    if (!preference && !webpayConnected) return null;
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        ...(preference ? { checkoutPreferenceId: preference.id, checkoutUrl: preference.checkoutUrl } : {}),
        checkoutExpiresAt: expiresAt,
        statusTokenHash: hashToken(statusToken),
      },
    });
    logger.info("pedidos: cobro creado", { organizationId: order.organizationId, orderId: order.id, mercadoPago: preference !== null, webpay: webpayConnected });
    // El pago con Webpay se hace desde «Tu pedido»: ahí se crea la transacción en el momento de pagar.
    return { checkoutUrl: preference?.checkoutUrl ?? null, webpayUrl: webpayConnected ? statusUrl : null, statusUrl };
  }

  // ───────────────────────────── Webpay Plus (F10.2d, ADR-030) ─────────────────────────────

  private async payableOrder(token: string): Promise<Order> {
    if (!token || token.length > 100) throw new NotFoundException(ORDER_STATUS_NOT_FOUND);
    const order = await this.prisma.order.findFirst({ where: { statusTokenHash: hashToken(token), site: SERVED_SITE } });
    if (!order) throw new NotFoundException(ORDER_STATUS_NOT_FOUND);
    return order;
  }

  private isPayable(order: Order): boolean {
    return (
      order.status === "NEW" &&
      order.providerPaymentId === null &&
      order.totalAmount > 0 &&
      checkoutSupportsCurrency(order.priceCurrency) &&
      (order.checkoutExpiresAt?.getTime() ?? 0) > Date.now()
    );
  }

  /**
   * El comprador pulsa «Pagar con Webpay» en «Tu pedido»: se crea una transacción nueva a nombre del negocio, por el total guardado del
   * pedido (nunca un monto del visitante). Cada intento crea la suya; solo la última queda guardada y es la que se confirma al volver.
   */
  async startWebpay(token: string): Promise<OrderWebpayStartResponse> {
    const order = await this.payableOrder(token);
    if (!this.urlsConfigured() || !this.isPayable(order)) throw new ConflictException(NOT_PAYABLE);
    const credentials = await this.accounts.webpayPlusFor(order.organizationId);
    if (!credentials) throw new ServiceUnavailableException("El pago con Webpay no está disponible ahora. Escríbele al negocio.");

    const buyOrder = newWebpayPlusBuyOrder();
    const returnUrl = `${env.API_PUBLIC_URL!.replace(/\/+$/, "")}/api/v1/payments/webpay/orders/${order.id}/return?t=${encodeURIComponent(token)}`;
    let transaction;
    try {
      transaction = await this.webpay.create(credentials, { buyOrder, sessionId: order.id, amount: order.totalAmount, returnUrl });
    } catch (error) {
      logger.warn("pedidos: no se pudo crear la transacción de Webpay", {
        organizationId: order.organizationId,
        orderId: order.id,
        code: error instanceof PaymentGatewayError ? error.code : "unknown",
      });
      throw new ServiceUnavailableException("No pudimos iniciar el pago ahora. Intenta de nuevo en un momento.");
    }
    // Condicional: si en el intertanto el pedido se pagó (otro medio u otra pestaña), no se pisa nada.
    const saved = await this.prisma.order.updateMany({
      where: { id: order.id, providerPaymentId: null },
      data: { webpayToken: transaction.token, webpayBuyOrder: buyOrder, paymentProvider: PaymentGateway.WEBPAY_PLUS },
    });
    if (saved.count === 0) throw new ConflictException(NOT_PAYABLE);
    logger.info("pedidos: transacción creada en Webpay Plus", { organizationId: order.organizationId, orderId: order.id, liveMode: credentials.environment === "production" });
    return { checkoutUrl: transaction.url, method: "POST", fields: { token_ws: transaction.token } };
  }

  /**
   * El comprador vuelve de Webpay con `token_ws` (pagó o lo intentó) o `TBK_TOKEN` (abandonó). Webpay no avisa por webhook: el SERVIDOR
   * confirma la transacción que GUARDAMOS (nunca la de la URL), y solo la aplica si quedó autorizada y coincide orden de compra y monto.
   * Devuelve a dónde mandar al comprador (siempre «Tu pedido»), o `null` si el enlace no corresponde a ningún pedido.
   */
  async handleWebpayReturn(input: { orderId: string; statusToken: string | undefined; tokenWs: string | undefined; tbkToken: string | undefined }): Promise<string | null> {
    if (!UUID.test(input.orderId) || !input.statusToken || input.statusToken.length > 100) return null;
    const order = await this.prisma.order.findFirst({ where: { id: input.orderId, statusTokenHash: hashToken(input.statusToken) } });
    if (!order || !this.urlsConfigured()) return null;
    const statusUrl = `${env.PUBLIC_SITE_BASE_URL!.replace(/\/+$/, "")}/pedido/${encodeURIComponent(input.statusToken)}`;

    // Abandonó o la sesión venció en Webpay: no hay nada que confirmar; Transbank anula la transacción sola.
    if (!input.tokenWs) return statusUrl;
    // Solo la última transacción creada se confirma. Una anterior (otra pestaña) no se confirma y Transbank la revierte sola.
    if (!WEBPAY_TOKEN.test(input.tokenWs) || input.tokenWs !== order.webpayToken) {
      logger.warn("pedidos: el token de Webpay no corresponde al pedido", { organizationId: order.organizationId, orderId: order.id });
      return statusUrl;
    }
    // Ya confirmado (recargaron la URL de regreso): sin efecto.
    if (order.providerPaymentId !== null) return statusUrl;

    try {
      await this.settleWebpay(order);
    } catch (error) {
      logger.error("pedidos: no se pudo confirmar la transacción de Webpay", { orderId: order.id, code: error instanceof PaymentGatewayError ? error.code : "unknown" });
    }
    return statusUrl;
  }

  private async settleWebpay(order: Order): Promise<PaymentSyncResult> {
    const credentials = await this.accounts.webpayPlusFor(order.organizationId);
    if (!credentials || !order.webpayToken || !order.webpayBuyOrder) return "unavailable";

    let result;
    try {
      result = await this.webpay.commit(credentials, order.webpayToken);
    } catch (error) {
      // Transbank solo admite confirmar una vez: si otra pasada ya la confirmó, se lee su estado en vez de fallar.
      if (error instanceof PaymentGatewayError && error.code === "rejected") {
        result = await this.webpay.status(credentials, order.webpayToken);
      } else {
        throw error;
      }
    }

    const mismatches = webpayPlusMismatches(result, { buyOrder: order.webpayBuyOrder, amount: order.totalAmount });
    if (mismatches.length > 0) {
      // Tarjeta rechazada: se deja constancia y el comprador puede reintentar. Cualquier otra diferencia no se aplica.
      if (result.status !== "AUTHORIZED" && mismatches.every((reason) => reason === "status" || reason === "response_code")) {
        await this.prisma.order.updateMany({ where: { id: order.id, providerPaymentId: null }, data: { paymentStatus: "rejected" } });
        return "rejected";
      }
      logger.warn("pedidos: la transacción de Webpay no corresponde al pedido; no se aplica", { organizationId: order.organizationId, orderId: order.id, mismatches });
      return "mismatch";
    }
    // La orden de compra es única y aleatoria: sirve de identificador del pago (la columna es única, un pago nunca paga dos pedidos).
    return this.applyApproved(order, `webpay:${result.buyOrder}`, result.transactionDate ?? new Date(), PaymentGateway.WEBPAY_PLUS);
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

    return this.applyApproved(order, payment.id, payment.approvedAt ?? new Date(), PaymentGateway.MERCADO_PAGO);
  }

  /**
   * Un pago aprobado y verificado (de la pasarela que sea) se asigna al pedido, una sola vez: cancelado → se avisa al negocio; ya
   * pagado o entregado a mano → solo se guarda el pago; nuevo → pasa a pagado, se audita y se avisa.
   */
  private async applyApproved(order: Order, paymentId: string, paidAt: Date, provider: PaymentGateway): Promise<PaymentSyncResult> {
    const site = await this.prisma.site.findUnique({ where: { id: order.siteId }, select: { name: true } });
    const shownId = paymentId.startsWith("webpay:") ? paymentId.slice("webpay:".length) : paymentId;
    if (order.status === "CANCELLED") {
      // Pagaron un pedido cancelado: se deja constancia y se avisa al negocio (reactivar o devolver).
      const claimed = await this.claimPayment(order, paymentId, provider, {});
      if (!claimed) return "unchanged";
      await this.audit.record({ organizationId: order.organizationId, actorId: null, action: "order.cancelled_order_paid", targetType: "Order", targetId: order.id, metadata: { provider, paymentId } });
      await this.notifier.notifyCancelledOrderPaid(claimed, site?.name ?? "", shownId);
      logger.warn("pedidos: pagaron un pedido cancelado", { organizationId: order.organizationId, orderId: order.id });
      return "cancelled_paid";
    }
    if (order.status !== "NEW") {
      // El negocio ya lo había marcado pagado o entregado a mano: se guarda el pago, sin avisos.
      return (await this.claimPayment(order, paymentId, provider, {})) ? "updated" : "unchanged";
    }

    const paid = await this.claimPayment(order, paymentId, provider, { status: "PAID", paidAt }, "NEW");
    if (!paid) return "unchanged";
    await this.audit.record({ organizationId: order.organizationId, actorId: null, action: "order.paid_online", targetType: "Order", targetId: order.id, metadata: { provider, paymentId } });
    await this.notifier.notifyPaidOnline(paid, site?.name ?? "", shownId);
    await this.webhookEvents.emit({ organizationId: order.organizationId, type: "order.paid", subjectId: order.id });
    logger.info("pedidos: pago confirmado", { organizationId: order.organizationId, orderId: order.id, provider });
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
  private async claimPayment(order: Order, paymentId: string, provider: PaymentGateway, data: { status?: "PAID"; paidAt?: Date }, expectedStatus?: "NEW"): Promise<Order | null> {
    try {
      const result = await this.prisma.order.updateMany({
        where: { id: order.id, providerPaymentId: null, ...(expectedStatus ? { status: expectedStatus } : {}) },
        data: { ...data, providerPaymentId: paymentId, paymentStatus: "approved", paymentProvider: provider },
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
      where: { statusTokenHash: hashToken(token), site: SERVED_SITE },
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
    const open = order.status === "NEW" && order.paymentStatus !== "approved" && (order.checkoutExpiresAt?.getTime() ?? 0) > Date.now();
    const canPay = open && order.checkoutUrl !== null;
    const webpayAvailable = open && this.isPayable(order) && this.urlsConfigured() && (await this.accounts.webpayPlusFor(order.organizationId)) !== null;
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
      webpayAvailable,
      downloadUrl,
    };
  }
}
