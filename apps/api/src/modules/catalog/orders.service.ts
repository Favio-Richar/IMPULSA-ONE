import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { OrderListResponse, OrderResponse } from "@impulza/contracts";
import type { Order, OrderStatus, Prisma, PrismaClient } from "@impulza/database";
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, type ListOrdersQuery, type UpdateOrderStatusInput } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { OrderNotifier } from "./order-notifier.js";

export const ORDER_NOT_FOUND = "Pedido no encontrado: no existe, o pertenece a otra organización (ADR-002).";
export const ORDER_CHANGED = "El pedido cambió mientras lo editabas. Recarga e inténtalo de nuevo.";
export const ORDER_NO_STOCK = "No quedan unidades suficientes para reabrir el pedido.";
export const ONLINE_PAYMENT_UNDO = "Este pago lo confirmó Mercado Pago: no se puede deshacer desde aquí. Si debes devolver el dinero, hazlo desde tu cuenta de Mercado Pago.";

export const ORDERS_PAGE_SIZE = 50;

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
  ) {}

  toResponse(order: Order): OrderResponse {
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
      onlinePayment: order.checkoutPreferenceId ? { status: order.paymentStatus, paymentId: order.providerPaymentId } : null,
      paidAt: order.paidAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private async getOrThrow(organizationId: string, orderId: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, organizationId } });
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
      this.prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * ORDERS_PAGE_SIZE, take: ORDERS_PAGE_SIZE }),
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
      if (next === "CANCELLED" && current.stockReserved) {
        // Devolver lo reservado. Si el producto ya no existe (FK `SET NULL`) no hay a dónde devolverlo.
        if (current.productId) {
          await tx.product.updateMany({ where: { id: current.productId, stock: { not: null } }, data: { stock: { increment: current.quantity } } });
        }
        stockReserved = false;
      }
      if (current.status === "CANCELLED" && current.productId) {
        const product = await tx.product.findUnique({ where: { id: current.productId }, select: { stock: true } });
        if (product && product.stock !== null) {
          const reserved = await tx.product.updateMany({
            where: { id: current.productId, stock: { gte: current.quantity } },
            data: { stock: { decrement: current.quantity } },
          });
          if (reserved.count === 0) {
            throw new ConflictException(ORDER_NO_STOCK);
          }
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
      return tx.order.findUniqueOrThrow({ where: { id: current.id } });
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
    logger.info("pedido cambió de estado", { organizationId, orderId: current.id, from: current.status, to: next });
    return this.toResponse(updated);
  }
}
