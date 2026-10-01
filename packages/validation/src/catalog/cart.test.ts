import { describe, expect, it } from "vitest";
import { cartOrderSummaryName, MAX_CART_LINES, publicCartCouponCheckSchema, publicCartOrderRequestSchema } from "./index.js";

const P1 = "7f8c6b84-60d0-4f2b-9a35-6a3b0c4c2d11";
const P2 = "0b4e3f5a-2c1d-4e6f-8a9b-1c2d3e4f5a6b";
const V1 = "3c2b1a09-8f7e-4d6c-9b5a-0f1e2d3c4b5a";
const customer = { name: "Ana", email: "ana@ejemplo.cl", consent: true as const };

describe("carrito (F7.8c, ADR-023)", () => {
  it("un pedido de carrito lleva de 1 a 20 líneas, sin repetir producto y variante", () => {
    const ok = publicCartOrderRequestSchema.parse({ ...customer, lines: [{ productId: P1, quantity: 2 }, { productId: P1, variantId: V1, quantity: 1 }, { productId: P2, quantity: 1 }] });
    expect(ok.lines).toHaveLength(3);
    expect(publicCartOrderRequestSchema.safeParse({ ...customer, lines: [] }).error?.issues[0]?.message).toBe("Tu carrito está vacío.");
    const repeated = publicCartOrderRequestSchema.safeParse({ ...customer, lines: [{ productId: P1, quantity: 1 }, { productId: P1, quantity: 3 }] });
    expect(repeated.error?.issues[0]?.message).toBe("El mismo producto aparece dos veces en el carrito.");
    const many = Array.from({ length: MAX_CART_LINES + 1 }, (_, index) => ({ productId: P1, variantId: `${V1.slice(0, -2)}${String(index).padStart(2, "0")}`, quantity: 1 }));
    expect(publicCartOrderRequestSchema.safeParse({ ...customer, lines: many }).success).toBe(false);
    expect(publicCartOrderRequestSchema.safeParse({ ...customer, lines: [{ productId: P1, quantity: 0 }] }).success).toBe(false);
    // El navegador no manda precios: si los manda, no se aceptan como parte del pedido.
    expect(publicCartOrderRequestSchema.parse({ ...customer, lines: [{ productId: P1, quantity: 1, priceAmount: 1 }] }).lines[0]).toEqual({ productId: P1, quantity: 1 });
  });

  it("probar un código con el carrito usa las mismas reglas de líneas", () => {
    expect(publicCartCouponCheckSchema.parse({ code: " dia10 ", lines: [{ productId: P1, quantity: 1 }] }).code).toBe("dia10");
    expect(publicCartCouponCheckSchema.safeParse({ code: "X", lines: [] }).success).toBe(false);
  });

  it("el nombre resumen dice cuántos productos más hay", () => {
    expect(cartOrderSummaryName(["Polera (M)"])).toBe("Polera (M)");
    expect(cartOrderSummaryName(["Polera (M)", "Taza"])).toBe("Polera (M) y 1 producto más");
    expect(cartOrderSummaryName(["Polera (M)", "Taza", "Vela"])).toBe("Polera (M) y 2 productos más");
  });
});

describe("correos de un pedido de carrito (F7.8c)", async () => {
  const { orderReceivedEmail, ownerNewOrderEmail } = await import("./index.js");
  const data = {
    siteName: "Tienda",
    productName: "Polera (M) y 1 producto más",
    quantity: 1,
    unitPriceAmount: 30000,
    totalAmount: 27000,
    priceCurrency: "CLP",
    paymentUrl: null,
    discountAmount: 3000,
    couponCode: "DIA10",
    items: [
      { productName: "Polera", variantName: "M", quantity: 2, lineTotalAmount: 20000 },
      { productName: "Taza", variantName: null, quantity: 1, lineTotalAmount: 10000 },
    ],
  };

  it("detallan cada línea, el descuento y el total; el asunto al dueño usa el resumen", () => {
    expect(orderReceivedEmail(data).text).toContain("2 × Polera (M): $20.000\n1 × Taza: $10.000\nDescuento (DIA10): −$3.000\nTotal: $27.000");
    const owner = ownerNewOrderEmail({ ...data, customerName: "Ana", customerEmail: "ana@x.cl", customerPhone: null, deliveryAddress: null, note: null, ordersUrl: null });
    expect(owner.subject).toBe("Nuevo pedido: Polera (M) y 1 producto más de Ana");
  });
});
