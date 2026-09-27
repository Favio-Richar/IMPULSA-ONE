import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CatalogBlock, selectCatalogProducts } from "./catalog.js";

const base = { description: null, kind: "PHYSICAL" as const, priceAmount: 7990, priceCurrency: "CLP", image: null, available: true, maxQuantity: 99 };
const products = [
  { ...base, id: "a", categoryId: "velas", name: "Vela" },
  { ...base, id: "b", categoryId: "jabones", name: "Jabón" },
  { ...base, id: "c", categoryId: null, name: "Guía" },
];

describe("CatalogBlock — tienda en la pila (F5.5)", () => {
  it("sin filtro muestra todo; con ids, solo esos y en ese orden; con categoría, los de esa categoría", () => {
    expect(selectCatalogProducts(products, {}).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(selectCatalogProducts(products, { productIds: ["c", "x", "a"] }).map((p) => p.id)).toEqual(["c", "a"]);
    expect(selectCatalogProducts(products, { categoryId: "jabones" }).map((p) => p.id)).toEqual(["b"]);
  });

  it("en la vista previa es un botón de la pila y no pide nada a la red", () => {
    const html = renderToStaticMarkup(<CatalogBlock config={{ label: "Tienda" }} mode="preview" />);
    expect(html).toContain("data-catalog-block");
    expect(html).toContain("Tienda");
    expect(html).toContain("min-h-14");
  });
});
