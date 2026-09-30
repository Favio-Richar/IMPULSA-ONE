import { describe, expect, it } from "vitest";
import { bookingDepositRefundedEmail, ownerBookingNoticeEmail } from "../bookings/messages.js";
import { orderRefundedEmail, ownerOrderDisputeEmail, refundRequestSchema } from "./index.js";

// F5.11a — devoluciones y contracargos: la solicitud y los correos.

const order = {
  siteName: "Tienda Sol",
  productName: "Curso",
  quantity: 2,
  unitPriceAmount: 20_000,
  totalAmount: 40_000,
  priceCurrency: "CLP",
  paymentUrl: null,
};

describe("devoluciones (F5.11a)", () => {
  it("la solicitud acepta devolver todo (sin monto) o una parte mayor que cero", () => {
    expect(refundRequestSchema.safeParse({}).success).toBe(true);
    expect(refundRequestSchema.safeParse({ amount: 5_000 }).success).toBe(true);
    expect(refundRequestSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(refundRequestSchema.safeParse({ amount: 1.5 }).success).toBe(false);
  });

  it("al comprador: cuánto se devolvió, total o parcial", () => {
    expect(orderRefundedEmail(order, 15_000, false).subject).toBe("Te devolvimos parte del pago de tu pedido en Tienda Sol");
    const full = orderRefundedEmail(order, 40_000, true);
    expect(full.subject).toBe("Te devolvimos el pago de tu pedido en Tienda Sol");
    expect(full.text).toContain("te devolvió $40.000");
  });

  it("al negocio: contracargo o reclamo, con el id del pago y qué hacer", () => {
    const data = { ...order, customerName: "Ana", paymentId: "999", ordersUrl: null };
    const chargeback = ownerOrderDisputeEmail(data, "charged_back");
    expect(chargeback.subject).toContain("Contracargo en Mercado Pago");
    expect(chargeback.text).toContain("Pago en Mercado Pago: 999");
    expect(ownerOrderDisputeEmail(data, "in_mediation").subject).toContain("Reclamo abierto");
  });

  it("señas: devolución al cliente y contracargo al negocio", () => {
    const booking = { siteName: "Estudio", serviceName: "Masaje", startsAt: "2026-09-29T13:00:00Z", timeZone: "America/Santiago", priceAmount: 30_000, priceCurrency: "CLP", paymentUrl: null, manageUrl: null };
    expect(bookingDepositRefundedEmail(booking, 6_000).text).toContain("te devolvió $6.000");
    const owner = ownerBookingNoticeEmail({ kind: "charged_back", siteName: "Estudio", serviceName: "Masaje", startsAt: booking.startsAt, timeZone: booking.timeZone, customerName: "Ana", customerEmail: "a@example.com", customerPhone: null, note: null, agendaUrl: null });
    expect(owner.subject).toContain("Contracargo de una seña");
    expect(owner.text).toContain("reclamos y contracargos");
  });
});
