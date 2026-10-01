import { Inject, Injectable } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import { type Order, type PrismaClient, ProductFileStatus } from "@impulza/database";
import {
  orderPaidOnlineEmail,
  orderReceivedEmail,
  orderStatusEmail,
  orderRefundedEmail,
  ownerCancelledOrderPaidEmail,
  ownerOrderDisputeEmail,
  ownerNewOrderEmail,
  ownerOrderPaidOnlineEmail,
  type OrderEmailContent,
  type OrderMessageData,
  type OrderStatusNotice,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { downloadState, orderDownloadPageUrl } from "./download-access.js";

/**
 * Correos de pedidos (F5.5): al cliente (recibido, pagado, entregado, cancelado) y a los dueños.
 * Nunca hacen fallar la operación que los dispara: se registra el error y se sigue.
 */
@Injectable()
export class OrderNotifier {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
  ) {}

  private async send(to: string, content: OrderEmailContent, context: Record<string, unknown>): Promise<void> {
    try {
      await this.email.send({ to, subject: content.subject, text: content.text });
    } catch (error) {
      logger.error("no se pudo enviar un correo de pedido", { ...context, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private messageData(order: Order, siteName: string, statusUrl?: string | null): OrderMessageData {
    return {
      siteName,
      productName: order.productName,
      quantity: order.quantity,
      unitPriceAmount: order.unitPriceAmount,
      totalAmount: order.totalAmount,
      priceCurrency: order.priceCurrency,
      paymentUrl: order.paymentUrl,
      statusUrl: statusUrl ?? null,
      discountAmount: order.discountAmount,
      couponCode: order.couponCode,
    };
  }

  /** Enlace de descarga (F5.11b) si el pedido ya entrega su archivo; si no, `null`. */
  private async downloadUrlFor(order: Order): Promise<string | null> {
    if (order.productKind !== "DIGITAL" || !order.productId) return null;
    const file = await this.prisma.productFile.findFirst({ where: { productId: order.productId, status: ProductFileStatus.READY }, select: { id: true } });
    return downloadState(order, file !== null) === "ready" ? orderDownloadPageUrl(order.id) : null;
  }

  private ordersUrl(): string {
    return `${env.APP_BASE_URL.replace(/\/$/, "")}/pedidos`;
  }

  /** `statusUrl`: enlace "Tu pedido" cuando se cobra con Mercado Pago (F5.9); solo existe al crearlo. */
  async notifyReceived(order: Order, siteName: string, statusUrl?: string | null): Promise<void> {
    await this.send(order.customerEmail, orderReceivedEmail(this.messageData(order, siteName, statusUrl)), { orderId: order.id, kind: "received", to: "customer" });
  }

  /** Mercado Pago confirmó el pago (F5.9): al comprador y a los dueños. */
  async notifyPaidOnline(order: Order, siteName: string, paymentId: string): Promise<void> {
    const data = { ...this.messageData(order, siteName), downloadUrl: await this.downloadUrlFor(order) };
    await this.send(order.customerEmail, orderPaidOnlineEmail(data), { orderId: order.id, kind: "paid_online", to: "customer" });
    const content = ownerOrderPaidOnlineEmail({ ...this.messageData(order, siteName), customerName: order.customerName, paymentId, ordersUrl: this.ordersUrl() });
    await this.sendToOwners(order, content, "paid_online");
  }

  /** Pagaron un pedido que estaba cancelado (F5.9): el negocio decide si lo reactiva o devuelve el dinero. */
  async notifyCancelledOrderPaid(order: Order, siteName: string, paymentId: string): Promise<void> {
    const content = ownerCancelledOrderPaidEmail({ ...this.messageData(order, siteName), customerName: order.customerName, paymentId, ordersUrl: this.ordersUrl() });
    await this.sendToOwners(order, content, "cancelled_paid");
  }

  /** El negocio devolvió dinero (F5.11a): aviso al comprador. */
  async notifyRefunded(order: Order, siteName: string, amount: number): Promise<void> {
    const content = orderRefundedEmail(this.messageData(order, siteName), amount, order.refundedAmount >= order.totalAmount);
    await this.send(order.customerEmail, content, { orderId: order.id, kind: "refunded", to: "customer" });
  }

  /** Contracargo o reclamo en Mercado Pago (F5.11a): aviso a los dueños. */
  async notifyDispute(order: Order, siteName: string, paymentId: string, status: "charged_back" | "in_mediation"): Promise<void> {
    const content = ownerOrderDisputeEmail({ ...this.messageData(order, siteName), customerName: order.customerName, paymentId, ordersUrl: this.ordersUrl() }, status);
    await this.sendToOwners(order, content, status);
  }

  private async sendToOwners(order: Order, content: OrderEmailContent, kind: string): Promise<void> {
    const owners = await this.prisma.membership.findMany({
      where: { organizationId: order.organizationId, status: "ACTIVE", role: { name: "OWNER" } },
      select: { user: { select: { email: true } } },
    });
    for (const owner of owners) {
      await this.send(owner.user.email, content, { orderId: order.id, kind, to: "owner" });
    }
  }

  async notifyStatus(status: OrderStatusNotice, order: Order, siteName: string): Promise<void> {
    const data = { ...this.messageData(order, siteName), downloadUrl: status === "CANCELLED" ? null : await this.downloadUrlFor(order) };
    await this.send(order.customerEmail, orderStatusEmail(status, data), { orderId: order.id, kind: status, to: "customer" });
  }

  /** Aviso de pedido nuevo a los dueños activos de la organización. */
  async notifyOwners(order: Order, siteName: string): Promise<void> {
    const content = ownerNewOrderEmail({
      ...this.messageData(order, siteName),
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      deliveryAddress: order.deliveryAddress,
      note: order.note,
      ordersUrl: this.ordersUrl(),
    });
    await this.sendToOwners(order, content, "new");
  }
}
