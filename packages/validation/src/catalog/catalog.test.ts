import { describe, expect, it } from "vitest";
import {
  formatMoneyAmount,
  ORDER_TRANSITIONS,
  orderReceivedEmail,
  ownerNewOrderEmail,
  productSchema,
  publicOrderRequestSchema,
  updateProductSchema,
} from "./index.js";

const order = {
  siteName: "Tienda Lumen",
  productName: "Vela de soya",
  quantity: 2,
  unitPriceAmount: 7990,
  totalAmount: 15980,
  priceCurrency: "CLP",
  paymentUrl: "https://pago.ejemplo.cl/vela",
};

describe("catálogo y pedidos (F5.5)", () => {
  it("un producto exige precio y moneda, y un enlace de pago seguro", () => {
    expect(productSchema.parse({ name: "Vela", priceAmount: 7990, priceCurrency: "clp" })).toMatchObject({ kind: "PHYSICAL", priceCurrency: "CLP", active: true });
    expect(productSchema.safeParse({ name: "Vela", priceCurrency: "CLP" }).success).toBe(false);
    expect(productSchema.safeParse({ name: "Vela", priceAmount: -1, priceCurrency: "CLP" }).success).toBe(false);
    expect(productSchema.safeParse({ name: "Vela", priceAmount: 1, priceCurrency: "CLP", paymentUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(productSchema.safeParse({ name: "Vela", priceAmount: 1, priceCurrency: "CLP", stock: -2 }).success).toBe(false);
    expect(productSchema.safeParse({ name: "Vela", priceAmount: 1, priceCurrency: "CLP", image: { url: "https://cdn.ejemplo.cl/v.webp", alt: "Vela encendida" } }).success).toBe(true);
    expect(updateProductSchema.safeParse({ stock: null, paymentUrl: null }).success).toBe(true);
  });

  it("un pedido público valida cantidad, correo y consentimiento", () => {
    const base = { productId: "11111111-1111-4111-8111-111111111111", quantity: 1, name: "Ana", email: "ana@ejemplo.cl", consent: true };
    expect(publicOrderRequestSchema.safeParse(base).success).toBe(true);
    expect(publicOrderRequestSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(publicOrderRequestSchema.safeParse({ ...base, quantity: 100 }).success).toBe(false);
    expect(publicOrderRequestSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    expect(publicOrderRequestSchema.safeParse({ ...base, email: "no" }).success).toBe(false);
  });

  it("un pedido entregado no se reabre; uno cancelado puede volver a nuevo", () => {
    expect(ORDER_TRANSITIONS.DELIVERED).toEqual([]);
    expect(ORDER_TRANSITIONS.CANCELLED).toEqual(["NEW"]);
  });

  it("montos en unidad mínima según la moneda", () => {
    expect(formatMoneyAmount(15980, "CLP")).toBe("$15.980");
    expect(formatMoneyAmount(1990, "USD")).toContain("19,90");
  });

  it("los correos traen el detalle y el pago del negocio; el asunto nunca lleva saltos de línea", () => {
    const received = orderReceivedEmail(order);
    expect(received.subject).toBe("Recibimos tu pedido en Tienda Lumen");
    expect(received.text).toContain("2 × Vela de soya ($7.990 c/u)");
    expect(received.text).toContain("Total: $15.980");
    expect(received.text).toContain("https://pago.ejemplo.cl/vela");
    expect(orderReceivedEmail({ ...order, paymentUrl: null }).text).toContain("te contactará");

    const owner = ownerNewOrderEmail({ ...order, customerName: "Ana\nBcc: x@y.cl", customerEmail: "ana@ejemplo.cl", customerPhone: null, deliveryAddress: "Av. Siempre Viva 742", note: null, ordersUrl: null });
    expect(owner.subject).not.toMatch(/[\r\n]/);
    expect(owner.text).toContain("Dirección de entrega: Av. Siempre Viva 742");
  });
});
