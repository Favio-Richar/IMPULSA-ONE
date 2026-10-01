import { describe, expect, it } from "vitest";
import { productVariantSchema, productWithVariantName, publicOrderRequestSchema, updateProductVariantSchema } from "./index.js";

describe("variantes de producto (F7.8a, ADR-023)", () => {
  it("una variante necesita nombre; precio, stock y SKU son opcionales y nunca negativos", () => {
    expect(productVariantSchema.parse({ name: " M / Rojo " })).toEqual({ name: "M / Rojo", active: true });
    expect(productVariantSchema.parse({ name: "XL", priceAmount: 12990, stock: 0, sku: "POL-XL_01" })).toMatchObject({ priceAmount: 12990, stock: 0, sku: "POL-XL_01" });
    expect(productVariantSchema.safeParse({ name: "" }).success).toBe(false);
    expect(productVariantSchema.safeParse({ name: "M", stock: -1 }).success).toBe(false);
    expect(productVariantSchema.safeParse({ name: "M", priceAmount: -5 }).success).toBe(false);
    expect(productVariantSchema.safeParse({ name: "M", priceAmount: 10.5 }).success).toBe(false);
    expect(productVariantSchema.safeParse({ name: "M", sku: "con espacio" }).success).toBe(false);
    expect(productVariantSchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });

  it("editar acepta null para volver al precio del producto o quitar el stock, pero no un cuerpo vacío", () => {
    expect(updateProductVariantSchema.parse({ priceAmount: null, stock: null, sku: null })).toEqual({ priceAmount: null, stock: null, sku: null });
    expect(updateProductVariantSchema.parse({ position: 3 })).toEqual({ position: 3 });
    expect(updateProductVariantSchema.safeParse({}).success).toBe(false);
  });

  it("el pedido público acepta una variante opcional (la API decide si es obligatoria)", () => {
    const base = { productId: "7f8c6b84-60d0-4f2b-9a35-6a3b0c4c2d11", quantity: 1, name: "Ana", email: "ana@ejemplo.cl", consent: true as const };
    expect(publicOrderRequestSchema.parse(base).variantId).toBeUndefined();
    expect(publicOrderRequestSchema.parse({ ...base, variantId: "0b4e3f5a-2c1d-4e6f-8a9b-1c2d3e4f5a6b" }).variantId).toBe("0b4e3f5a-2c1d-4e6f-8a9b-1c2d3e4f5a6b");
    expect(publicOrderRequestSchema.safeParse({ ...base, variantId: "no-es-uuid" }).success).toBe(false);
  });

  it("el nombre del pedido lleva la variante entre paréntesis", () => {
    expect(productWithVariantName("Polera", "M / Rojo")).toBe("Polera (M / Rojo)");
    expect(productWithVariantName("Polera", null)).toBe("Polera");
  });
});
