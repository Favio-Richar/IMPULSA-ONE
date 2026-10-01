import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// El paquete corre sus pruebas sin DOM: se simulan `window.localStorage` y los eventos.
const store = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

const { addToCart, clearCart, parseStoredCart, removeFromCart, resetCartCacheForTests, setCartQuantity } = await import("./cart-store.js");

const P1 = "7f8c6b84-60d0-4f2b-9a35-6a3b0c4c2d11";
const P2 = "0b4e3f5a-2c1d-4e6f-8a9b-1c2d3e4f5a6b";
const V1 = "3c2b1a09-8f7e-4d6c-9b5a-0f1e2d3c4b5a";

function saved(): unknown {
  return JSON.parse(store.get("impulza-cart:lumen") ?? "[]");
}

describe("carrito del visitante (F7.8c)", () => {
  beforeEach(() => {
    store.clear();
    resetCartCacheForTests();
  });
  afterEach(() => resetCartCacheForTests());

  it("guarda solo ids y cantidades, suma la misma línea y respeta el tope de unidades", () => {
    expect(addToCart("lumen", { productId: P1, quantity: 2 })).toBe("added");
    addToCart("lumen", { productId: P1, quantity: 3 }, 4);
    addToCart("lumen", { productId: P1, variantId: V1, quantity: 1 });
    expect(saved()).toEqual([
      { productId: P1, quantity: 4 },
      { productId: P1, variantId: V1, quantity: 1 },
    ]);
    setCartQuantity("lumen", { productId: P1, variantId: V1 }, 500);
    expect((saved() as Array<{ quantity: number }>)[1]!.quantity).toBe(99);
    removeFromCart("lumen", { productId: P1 });
    expect(saved()).toEqual([{ productId: P1, variantId: V1, quantity: 99 }]);
    clearCart("lumen");
    expect(store.has("impulza-cart:lumen")).toBe(false);
  });

  it("un carrito lleno (20 líneas) no acepta otra línea distinta", () => {
    for (let index = 0; index < 20; index += 1) {
      addToCart("lumen", { productId: P1, variantId: `${V1.slice(0, -2)}${String(index).padStart(2, "0")}`, quantity: 1 });
    }
    expect(addToCart("lumen", { productId: P2, quantity: 1 })).toBe("full");
  });

  it("lo guardado se valida: JSON roto, campos de más, precios inventados o líneas repetidas se descartan", () => {
    expect(parseStoredCart("{roto")).toEqual([]);
    expect(parseStoredCart(JSON.stringify({ productId: P1 }))).toEqual([]);
    expect(
      parseStoredCart(
        JSON.stringify([
          { productId: P1, quantity: 1, priceAmount: 1 },
          { productId: P1, quantity: 5 },
          { productId: "no-es-uuid", quantity: 1 },
          { productId: P2, quantity: 0 },
        ]),
      ),
    ).toEqual([{ productId: P1, quantity: 1 }]);
  });
});
