import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CatalogBlock, productPriceLabel, selectCatalogProducts } from "./catalog.js";

const base = { description: null, kind: "PHYSICAL" as const, priceAmount: 7990, priceCurrency: "CLP", image: null, available: true, maxQuantity: 99, variants: [] };
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

  it("con variantes, el botón muestra el precio más bajo entre las disponibles, con «Desde» si varían (F7.8a)", () => {
    const variant = (id: string, priceAmount: number, available = true) => ({ id, name: id, priceAmount, available, maxQuantity: available ? 99 : 0 });
    expect(productPriceLabel({ ...base, variants: [] })).toBe(productPriceLabel({ ...base, variants: [variant("m", 7990)] }));
    expect(productPriceLabel({ ...base, variants: [variant("m", 9990), variant("l", 12990)] })).toMatch(/^Desde \$9\.990$/);
    // La más barata está agotada: el "desde" es el de las que se pueden pedir.
    expect(productPriceLabel({ ...base, variants: [variant("m", 5990, false), variant("l", 12990)] })).toMatch(/^\$12\.990$/);
    // Todas agotadas: igual se informa un precio (el botón dirá "Agotado").
    expect(productPriceLabel({ ...base, variants: [variant("m", 5990, false), variant("l", 12990, false)] })).toMatch(/^Desde \$5\.990$/);
  });
});
