import { describe, expect, it } from "vitest";
import { contrastRatio, meetsAaNormalText, meetsAaUiComponent, relativeLuminance } from "./contrast.js";

// Se verifica la calculadora contra valores conocidos de la especificación antes de confiar en
// ella para auditar temas: si la fórmula estuviera mal, todas las pruebas de accesibilidad que
// dependen de ella pasarían en falso.

describe("calculadora de contraste WCAG", () => {
  it("la luminancia de blanco y negro son los extremos conocidos", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });

  it("blanco sobre negro da el máximo posible de 21:1", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2);
  });

  it("un color contra sí mismo da 1:1", () => {
    expect(contrastRatio("#4338ca", "#4338ca")).toBeCloseTo(1, 5);
  });

  it("es simétrica: el orden de los colores no cambia el resultado", () => {
    expect(contrastRatio("#0f172a", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#0f172a"), 10);
  });

  it("coincide con valores de referencia publicados", () => {
    // #767676 sobre blanco es el gris límite clásico de AA para texto normal (4.54:1).
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
    // #949494 sobre blanco da 3.03:1 — alcanza para un componente de UI, no para texto.
    expect(contrastRatio("#949494", "#ffffff")).toBeCloseTo(3.03, 1);
    // #999999 sobre blanco da 2.85:1 — no alcanza para nada.
    expect(contrastRatio("#999999", "#ffffff")).toBeCloseTo(2.85, 1);
  });

  it("acepta mayúsculas y minúsculas en el hex", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(contrastRatio("#ffffff", "#000000"), 10);
  });

  it("los umbrales AA distinguen correctamente los casos límite", () => {
    // 4.54:1 — pasa texto normal.
    expect(meetsAaNormalText("#767676", "#ffffff")).toBe(true);

    // 3.03:1 — alcanza para un componente de UI (umbral 3) pero no para texto (umbral 4.5).
    // Justamente el caso que separa los dos umbrales y que hay que no confundir.
    expect(meetsAaUiComponent("#949494", "#ffffff")).toBe(true);
    expect(meetsAaNormalText("#949494", "#ffffff")).toBe(false);

    // 2.85:1 — no alcanza para ninguno de los dos.
    expect(meetsAaUiComponent("#999999", "#ffffff")).toBe(false);
    expect(meetsAaNormalText("#999999", "#ffffff")).toBe(false);
  });
});
