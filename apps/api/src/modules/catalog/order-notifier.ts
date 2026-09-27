import { Inject, Injectable } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import type { Order, PrismaClient } from "@impulza/database";
import {
  orderReceivedEmail,
  orderStatusEmail,
  ownerNewOrderEmail,
  type OrderEmailContent,
  type OrderMessageData,
  type OrderStatusNotice,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

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

  private messageData(order: Order, siteName: string): OrderMessageData {
    return {
      siteName,
      productName: order.productName,
      quantity: order.quantity,
      unitPriceAmount: order.unitPriceAmount,
      totalAmount: order.totalAmount,
      priceCurrency: order.priceCurrency,
      paymentUrl: order.paymentUrl,
    };
  }

  async notifyReceived(order: Order, siteName: string): Promise<void> {
    await this.send(order.customerEmail, orderReceivedEmail(this.messageData(order, siteName)), { orderId: order.id, kind: "received", to: "customer" });
  }

  async notifyStatus(status: OrderStatusNotice, order: Order, siteName: string): Promise<void> {
    await this.send(order.customerEmail, orderStatusEmail(status, this.messageData(order, siteName)), { orderId: order.id, kind: status, to: "customer" });
  }

  /** Aviso de pedido nuevo a los dueños activos de la organización. */
  async notifyOwners(order: Order, siteName: string): Promise<void> {
    const owners = await this.prisma.membership.findMany({
      where: { organizationId: order.organizationId, status: "ACTIVE", role: { name: "OWNER" } },
      select: { user: { select: { email: true } } },
    });
    const content = ownerNewOrderEmail({
      ...this.messageData(order, siteName),
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      deliveryAddress: order.deliveryAddress,
      note: order.note,
      ordersUrl: `${env.APP_BASE_URL.replace(/\/$/, "")}/pedidos`,
    });
    for (const owner of owners) {
      await this.send(owner.user.email, content, { orderId: order.id, to: "owner" });
    }
  }
}
