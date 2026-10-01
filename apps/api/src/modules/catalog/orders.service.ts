import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { OrderListResponse, OrderResponse } from "@impulza/contracts";
import type { Order, OrderItem, OrderStatus, Prisma, PrismaClient } from "@impulza/database";
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, type ListOrdersQuery, type RefundRequest, type UpdateOrderStatusInput } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { CheckoutRefundsService } from "../payment-accounts/checkout-refunds.service.js";
import { OrderNotifier } from "./order-notifier.js";
import { WebhookEventsService } from "../webhooks/webhook-events.service.js";

export const ORDER_NOT_FOUND = "Pedido no encontrado: no existe, o pertenece a otra organización (ADR-002).";
export const ORDER_CHANGED = "El pedido cambió mientras lo editabas. Recarga e inténtalo de nuevo.";
export const ORDER_NO_STOCK = "No quedan unidades suficientes para reabrir el pedido.";
export const NOTHING_TO_REFUND = "Este pedido no tiene un pago en línea que se pueda devolver.";
export const REFUND_TOO_HIGH = "No puedes devolver más de lo que queda del pago.";
export const ONLINE_PAYMENT_UNDO = "Este pago lo confirmó Mercado Pago: no se puede deshacer desde aquí. Si debes devolver el dinero, hazlo desde tu cuenta de Mercado Pago.";

export const ORDERS_PAGE_SIZE = 50;

type OrderWithItems = Order & { items: OrderItem[] };
const WITH_ITEMS = { items: { orderBy: { position: "asc" } } } satisfies Prisma.OrderInclude;
type Tx = Prisma.TransactionClient;

/** Devuelve a su fuente (variante o producto) lo que la línea había reservado (F7.8a, ADR-023). */
async function releaseItemStock(tx: Tx, item: OrderItem): Promise<void> {
  if (item.stockSource === "variant" && item.variantId) {
    await tx.productVariant.updateMany({ where: { id: item.variantId, stock: { not: null } }, data: { stock: { increment: item.quantity } } });
  } else if (item.stockSource === "product" && item.productId) {
    // Si el producto ya no existe (FK `SET NULL`) no hay a dónde devolverlo.
    await tx.product.updateMany({ where: { id: item.productId, stock: { not: null } }, data: { stock: { increment: item.quantity } } });
  }
}

/**
 * Vuelve a reservar el stock de una línea al reabrir un pedido. Una línea de variante reserva en su
 * variante (si la variante ya no existe, no reserva: el stock del producto no cuenta para variantes);
 * una línea sin variante, en el producto. Devuelve dónde reservó, o `null` si no hay control de stock.
 */
async function reserveItemStock(tx: Tx, item: OrderItem): Promise<"variant" | "product" | null> {
  if (item.variantName !== null) {
    if (!item.variantId) return null;
    const variant = await tx.productVariant.findUnique({ where: { id: item.variantId }, select: { stock: true } });
    if (!variant || variant.stock === null) return null;
    const reserved = await tx.productVariant.updateMany({ where: { id: item.variantId, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
    if (reserved.count === 0) throw new ConflictException(ORDER_NO_STOCK);
    return "variant";
  }
  if (!item.productId) return null;
  const product = await tx.product.findUnique({ where: { id: item.productId }, select: { stock: true } });
  if (!product || product.stock === null) return null;
  const reserved = await tx.product.updateMany({ where: { id: item.productId, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } });
  if (reserved.count === 0) throw new ConflictException(ORDER_NO_STOCK);
  return "product";
}

/**
 * Pedidos del negocio (F5.5): ver y avanzar su estado (nuevo → pagado → entregado, o cancelado).
 * El pago se marca a mano, salvo si se cobró con la cuenta de Mercado Pago del negocio (F5.9, se
 * marca solo al confirmarse). Al cancelar se devuelve el stock
 * reservado; al reabrir uno cancelado se vuelve a reservar (o 409 si ya no queda). Cada cambio es
 * condicional al estado leído, así dos personas del equipo no pisan el cambio de la otra.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly notifier: OrderNotifier,
    private readonly refunds: CheckoutRefundsService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  toResponse(order: OrderWithItems): OrderResponse {
    return {
      id: order.id,
      siteId: order.siteId,
      productId: order.productId,
      contactId: order.contactId,
      productName: order.productName,
      productKind: order.productKind,
      unitPriceAmount: order.unitPriceAmount,
      priceCurrency: order.priceCurrency,
      quantity: order.quantity,
      totalAmount: order.totalAmount,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      deliveryAddress: order.deliveryAddress,
      note: order.note,
      status: order.status,
      discountAmount: order.discountAmount,
      couponCode: order.couponCode,
      items: order.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        productName: item.productName,
        variantName: item.variantName,
        productKind: item.productKind,
        unitPriceAmount: item.unitPriceAmount,
        quantity: item.quantity,
        lineTotalAmount: item.lineTotalAmount,
      })),
      onlinePayment: order.checkoutPreferenceId
        ? { status: order.paymentStatus, paymentId: order.providerPaymentId, refundedAmount: order.refundedAmount }
        : null,
      downloadCount: order.downloadCount,
      paidAt: order.paidAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private async getOrThrow(organizationId: string, orderId: string): Promise<OrderWithItems> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, organizationId }, include: WITH_ITEMS });
    if (!order) {
      throw new NotFoundException(ORDER_NOT_FOUND);
    }
    return order;
  }

  async list(organizationId: string, query: ListOrdersQuery): Promise<OrderListResponse> {
    if (query.siteId) {
      const site = await this.prisma.site.findFirst({ where: { id: query.siteId, organizationId }, select: { id: true } });
      if (!site) {
        throw new NotFoundException("Sitio no encontrado.");
      }
    }
    const scope: Prisma.OrderWhereInput = { organizationId, ...(query.siteId ? { siteId: query.siteId } : {}) };
    const where: Prisma.OrderWhereInput = { ...scope, ...(query.status ? { status: query.status } : {}) };
    const [items, total, grouped] = await Promise.all([
      this.prisma.order.findMany({ where, include: WITH_ITEMS, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * ORDERS_PAGE_SIZE, take: ORDERS_PAGE_SIZE }),
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    ]);
    const counts = { NEW: 0, PAID: 0, DELIVERED: 0, CANCELLED: 0 };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }
    return { items: items.map((order) => this.toResponse(order)), total, page: query.page, pageSize: ORDERS_PAGE_SIZE, counts };
  }

  async get(organizationId: string, orderId: string): Promise<OrderResponse> {
    return this.toResponse(await this.getOrThrow(organizationId, orderId));
  }

  async updateStatus(organizationId: string, actorId: string, orderId: string, input: UpdateOrderStatusInput): Promise<OrderResponse> {
    const current = await this.getOrThrow(organizationId, orderId);
    if (current.status === input.status) {
      return this.toResponse(current);
    }
    if (current.status === "PAID" && input.status === "NEW" && current.providerPaymentId !== null) {
      throw new UnprocessableEntityException(ONLINE_PAYMENT_UNDO);
    }
    if (!ORDER_TRANSITIONS[current.status].includes(input.status)) {
      throw new UnprocessableEntityException(
        `Un pedido "${ORDER_STATUS_LABELS[current.status].toLowerCase()}" no puede pasar a "${ORDER_STATUS_LABELS[input.status].toLowerCase()}".`,
      );
    }
    const now = new Date();
    const next: OrderStatus = input.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      let stockReserved = current.stockReserved;
      // Stock por línea (F7.8a): cada línea devuelve o vuelve a reservar en su propia fuente, y
      // reabrir reserva todas o ninguna (un 409 revierte la transacción entera).
      if (next === "CANCELLED" && current.stockReserved) {
        for (const item of current.items) {
          await releaseItemStock(tx, item);
          if (item.stockSource !== null) {
            await tx.orderItem.update({ where: { id: item.id }, data: { stockSource: null } });
          }
        }
        stockReserved = false;
      }
      if (current.status === "CANCELLED") {
        let reservedAny = false;
        for (const item of current.items) {
          const source = await reserveItemStock(tx, item);
          reservedAny ||= source !== null;
          if (source !== item.stockSource) {
            await tx.orderItem.update({ where: { id: item.id }, data: { stockSource: source } });
          }
        }
        if (reservedAny) {
          stockReserved = true;
        }
      }
      const result = await tx.order.updateMany({
        where: { id: current.id, organizationId, status: current.status },
        data: {
          status: next,
          stockReserved,
          paidAt: next === "PAID" ? (current.paidAt ?? now) : next === "NEW" ? null : current.paidAt,
          deliveredAt: next === "DELIVERED" ? now : current.deliveredAt,
          cancelledAt: next === "CANCELLED" ? now : null,
        },
      });
      if (result.count === 0) {
        throw new ConflictException(ORDER_CHANGED);
      }
      return tx.order.findUniqueOrThrow({ where: { id: current.id }, include: WITH_ITEMS });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "order.status_changed",
      targetType: "Order",
      targetId: current.id,
      metadata: { from: current.status, to: next },
    });
    if (next === "PAID" || next === "DELIVERED" || next === "CANCELLED") {
      const site = await this.prisma.site.findUnique({ where: { id: updated.siteId }, select: { name: true } });
      await this.notifier.notifyStatus(next, updated, site?.name ?? "");
    }
    if (next === "PAID") {
      await this.webhookEvents.emit({ organizationId, type: "order.paid", subjectId: current.id });
    }
    logger.info("pedido cambió de estado", { organizationId, orderId: current.id, from: current.status, to: next });
    return this.toResponse(updated);
  }

  /**
   * Devolver dinero de un pedido cobrado con Mercado Pago (F5.11a), total o parcial. El tope es lo
   * que queda del pago; lo devuelto se guarda tal como lo informa Mercado Pago. El estado del pedido
   * no cambia solo: el negocio decide si además lo cancela.
   */
  async refund(organizationId: string, actorId: string, orderId: string, input: RefundRequest): Promise<OrderResponse> {
    // Validación temprana (sin candado) para responder rápido; se repite bajo el candado.
    const order = await this.getOrThrow(organizationId, orderId);
    const refundable = (current: OrderWithItems) => {
      if (!current.providerPaymentId || (current.paymentStatus !== "approved" && current.paymentStatus !== "refunded")) {
        throw new UnprocessableEntityException(NOTHING_TO_REFUND);
      }
      const remaining = current.totalAmount - current.refundedAmount;
      const amount = input.amount ?? remaining;
      if (remaining <= 0 || amount > remaining) {
        throw new UnprocessableEntityException(remaining <= 0 ? NOTHING_TO_REFUND : REFUND_TOO_HIGH);
      }
      return { paymentId: current.providerPaymentId, amount };
    };
    const { paymentId } = refundable(order);
    const { updated, amount } = await this.refunds.refund({
      organizationId,
      paymentId,
      // Bajo el candado: se vuelve a leer lo devuelto, así dos clics no validan contra una lectura vieja.
      prepare: async () => {
        const fresh = await this.getOrThrow(organizationId, orderId);
        const { amount: freshAmount } = refundable(fresh);
        // Lo ya devuelto entra en la clave: un reintento del mismo pedido de devolución es idempotente,
        // y una segunda devolución parcial (después de la primera) es otra operación.
        return { amount: freshAmount, idempotencyKey: `refund-order-${fresh.id}-${fresh.refundedAmount}-${freshAmount}` };
      },
      apply: async (payment, refundedNow) => ({
        amount: refundedNow,
        updated: await this.prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: payment.status, refundedAmount: Math.min(payment.refundedAmount, order.totalAmount) },
          include: WITH_ITEMS,
        }),
      }),
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "order.refunded",
      targetType: "Order",
      targetId: order.id,
      metadata: { provider: "MERCADO_PAGO", paymentId: order.providerPaymentId, amount, refundedTotal: updated.refundedAmount },
    });
    const site = await this.prisma.site.findUnique({ where: { id: order.siteId }, select: { name: true } });
    await this.notifier.notifyRefunded(updated, site?.name ?? "", amount);
    logger.info("pedido reembolsado", { organizationId, orderId: order.id, amount });
    return this.toResponse(updated);
  }
}
