import type { Booking, Contact, Order, OrderItem, PrismaClient } from "@impulza/database";
import type { WebhookEventType } from "@impulza/validation";

// Datos de cada evento (ADR-017 §3), con la forma de `WEBHOOK_SAMPLE_DATA`. Se leen de la base en el
// momento del evento, siempre acotados a la organización (ADR-002). Solo campos que el negocio ya ve
// en su panel: nunca tokens, hashes, ids de preferencia ni datos internos.

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function contactPayload(contact: Contact) {
  return {
    contact: {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      source: contact.source,
      marketingConsent: contact.marketingConsentAt !== null && contact.marketingUnsubscribedAt === null,
      createdAt: contact.createdAt.toISOString(),
    },
  };
}

export function bookingPayload(booking: Booking) {
  return {
    booking: {
      id: booking.id,
      siteId: booking.siteId,
      serviceName: booking.serviceName,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      timeZone: booking.timeZone,
      status: booking.status,
      priceAmount: booking.priceAmount,
      priceCurrency: booking.priceCurrency,
      deposit: booking.depositAmount !== null ? { amount: booking.depositAmount, paidAt: iso(booking.depositPaidAt), refundedAmount: booking.depositRefundedAmount } : null,
      customer: { name: booking.customerName, email: booking.customerEmail, phone: booking.customerPhone },
      note: booking.note,
    },
  };
}

/** `items`: las líneas del pedido (F7.8a, ADR-023); los campos de siempre quedan como resumen. */
export function orderPayload(order: Order & { items?: OrderItem[] }) {
  return {
    order: {
      id: order.id,
      siteId: order.siteId,
      productName: order.productName,
      productKind: order.productKind,
      quantity: order.quantity,
      unitPriceAmount: order.unitPriceAmount,
      totalAmount: order.totalAmount,
      priceCurrency: order.priceCurrency,
      status: order.status,
      paidAt: iso(order.paidAt),
      onlinePayment: order.providerPaymentId ? { provider: "MERCADO_PAGO", paymentId: order.providerPaymentId } : null,
      customer: { name: order.customerName, email: order.customerEmail, phone: order.customerPhone },
      deliveryAddress: order.deliveryAddress,
      note: order.note,
      items: (order.items ?? []).map((item) => ({
        productName: item.productName,
        variantName: item.variantName,
        productKind: item.productKind,
        unitPriceAmount: item.unitPriceAmount,
        quantity: item.quantity,
        lineTotalAmount: item.lineTotalAmount,
      })),
    },
  };
}

/** Arma los datos de un evento a partir del id de lo que pasó. `null` si ya no existe en la organización. */
export async function buildWebhookData(prisma: PrismaClient, organizationId: string, type: WebhookEventType, subjectId: string): Promise<unknown> {
  switch (type) {
    case "contact.created": {
      const contact = await prisma.contact.findFirst({ where: { id: subjectId, organizationId } });
      return contact ? contactPayload(contact) : null;
    }
    case "booking.created":
    case "booking.cancelled": {
      const booking = await prisma.booking.findFirst({ where: { id: subjectId, organizationId } });
      return booking ? bookingPayload(booking) : null;
    }
    case "order.created":
    case "order.paid": {
      const order = await prisma.order.findFirst({ where: { id: subjectId, organizationId }, include: { items: { orderBy: { position: "asc" } } } });
      return order ? orderPayload(order) : null;
    }
  }
}
