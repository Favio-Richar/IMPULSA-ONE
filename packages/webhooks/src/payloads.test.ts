import type { Booking, Contact, Order } from "@impulza/database";
import { WEBHOOK_SAMPLE_DATA } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { bookingPayload, contactPayload, orderPayload } from "./payloads.js";

// La carga útil real tiene exactamente la forma de los ejemplos que muestra el panel (lo que el
// negocio mapea en Zapier o Make) y nunca lleva campos internos.

/** Forma de un valor: las claves de cada objeto, recursivo (los valores nulos no fijan forma). */
function keysOf(value: unknown): unknown {
  if (value === null || typeof value !== "object") return typeof value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, inner !== null && typeof inner === "object" ? keysOf(inner) : "·"]));
}

const date = new Date("2026-09-30T14:05:00.000Z");

const contact = {
  id: "c1",
  organizationId: "o1",
  name: "Ana",
  email: "ana@ejemplo.cl",
  phone: null,
  source: "form",
  tags: ["vip"],
  consentStatus: "GRANTED",
  marketingConsentAt: date,
  marketingUnsubscribedAt: null,
  assignedToId: "u1",
  createdAt: date,
  updatedAt: date,
} as unknown as Contact;

const booking = {
  id: "b1",
  organizationId: "o1",
  siteId: "s1",
  serviceName: "Corte",
  startsAt: date,
  endsAt: date,
  timeZone: "America/Santiago",
  status: "CONFIRMED",
  priceAmount: 18000,
  priceCurrency: "CLP",
  depositAmount: 5000,
  depositPaidAt: date,
  depositRefundedAmount: 0,
  checkoutPreferenceId: "pref-secreta",
  checkoutUrl: "https://mp.ejemplo/checkout",
  providerPaymentId: "123",
  customerName: "Ana",
  customerEmail: "ana@ejemplo.cl",
  customerPhone: "+569",
  note: null,
} as unknown as Booking;

const order = {
  id: "o1",
  organizationId: "o1",
  siteId: "s1",
  productName: "Torta",
  productKind: "PHYSICAL",
  quantity: 2,
  unitPriceAmount: 100,
  totalAmount: 200,
  priceCurrency: "CLP",
  status: "PAID",
  paidAt: date,
  providerPaymentId: "999",
  paymentUrl: "https://pago.ejemplo/interno",
  checkoutPreferenceId: "pref-secreta",
  statusTokenHash: "hash-secreto",
  customerName: "Ana",
  customerEmail: "ana@ejemplo.cl",
  customerPhone: null,
  deliveryAddress: "Calle 1",
  note: "sin gluten",
} as unknown as Order;

describe("carga útil de los eventos (ADR-017 §5)", () => {
  it("tiene la misma forma que los ejemplos del panel", () => {
    expect(keysOf(contactPayload(contact))).toEqual(keysOf(WEBHOOK_SAMPLE_DATA["contact.created"]));
    // El ejemplo de `booking.created` trae seña; el de `order.paid`, pago en línea.
    expect(keysOf(bookingPayload(booking))).toEqual(keysOf(WEBHOOK_SAMPLE_DATA["booking.created"]));
    expect(keysOf(orderPayload(order))).toEqual(keysOf(WEBHOOK_SAMPLE_DATA["order.paid"]));
  });

  it("nunca incluye tokens, hashes, preferencias ni enlaces internos", () => {
    const all = JSON.stringify([contactPayload(contact), bookingPayload(booking), orderPayload(order)]);
    for (const secret of ["pref-secreta", "hash-secreto", "mp.ejemplo", "pago.ejemplo", "assignedTo", "u1", "vip"]) {
      expect(all).not.toContain(secret);
    }
  });

  it("marketing: solo con consentimiento vigente", () => {
    expect(contactPayload(contact).contact.marketingConsent).toBe(true);
    expect(contactPayload({ ...contact, marketingUnsubscribedAt: date }).contact.marketingConsent).toBe(false);
    expect(contactPayload({ ...contact, marketingConsentAt: null }).contact.marketingConsent).toBe(false);
  });

  it("sin seña ni pago en línea, esos campos van en null", () => {
    expect(bookingPayload({ ...booking, depositAmount: null }).booking.deposit).toBeNull();
    expect(orderPayload({ ...order, providerPaymentId: null }).order.onlinePayment).toBeNull();
    expect(orderPayload(order).order.onlinePayment).toEqual({ provider: "MERCADO_PAGO", paymentId: "999" });
  });
});
