import { describe, expect, it } from "vitest";
import { contrastRatio } from "../contrast.js";
import { getQrStylePreset, QR_STYLE_CATALOG } from "./index.js";

// F3.5 — el contraste de un QR es funcional, no solo estético: exige más que el mínimo de texto
// normal de WCAG (4.5:1) para escanear de forma confiable con cámaras de gama baja.
const MIN_SCAN_CONTRAST = 7;

describe("catálogo de estilos de QR (F3.5)", () => {
  it("cada preset supera el mínimo de contraste para escanear de forma confiable", () => {
    for (const preset of QR_STYLE_CATALOG) {
      expect(
        contrastRatio(preset.foreground, preset.background),
        `${preset.key}: contraste insuficiente para un QR confiable`,
      ).toBeGreaterThanOrEqual(MIN_SCAN_CONTRAST);
    }
  });

  it("cada preset tiene una clave única", () => {
    const keys = QR_STYLE_CATALOG.map((preset) => preset.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("getQrStylePreset devuelve null para una clave desconocida", () => {
    expect(getQrStylePreset("no-existe")).toBeNull();
    expect(getQrStylePreset("clasico")).not.toBeNull();
  });
});
