import { HEALTH_FINDING_CODES } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { HEALTH_MESSAGES, healthMessage, scoreLabel } from "./page-health-messages";

describe("mensajes de salud de página (F6.1)", () => {
  it("todo código del servidor tiene título y detalle en español, sin textos repetidos", () => {
    for (const code of HEALTH_FINDING_CODES) {
      expect(HEALTH_MESSAGES[code].title.length).toBeGreaterThan(5);
      expect(HEALTH_MESSAGES[code].detail.length).toBeGreaterThan(10);
    }
    const titles = HEALTH_FINDING_CODES.map((code) => HEALTH_MESSAGES[code].title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("un código desconocido (servidor más nuevo) se muestra genérico en vez de romper", () => {
    expect(healthMessage("codigo_del_futuro")).toMatchObject({ title: "Revisa esta página", fix: null });
  });

  it("la lectura del puntaje tiene tres tramos", () => {
    expect(scoreLabel(100).tone).toBe("good");
    expect(scoreLabel(90).tone).toBe("good");
    expect(scoreLabel(89).tone).toBe("fair");
    expect(scoreLabel(60).tone).toBe("fair");
    expect(scoreLabel(59).tone).toBe("poor");
  });
});
