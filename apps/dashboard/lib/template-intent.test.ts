import { beforeEach, describe, expect, it } from "vitest";
import { captureTemplateIntent, clearTemplateIntent, peekTemplateIntent } from "./template-intent";

/** `localStorage` en memoria: el módulo solo usa getItem/setItem/removeItem. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

describe("plantilla elegida en la galería pública", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: memoryStorage() };
  });

  it("guarda un código válido de `?plantilla=` y lo devuelve hasta que se consume", () => {
    expect(captureTemplateIntent("?plantilla=clinica-dental&utm_source=x", 1_000)).toBe("clinica-dental");
    expect(peekTemplateIntent(2_000)).toBe("clinica-dental");
    clearTemplateIntent();
    expect(peekTemplateIntent(2_000)).toBeNull();
  });

  it("ignora códigos con otro formato (nada de rutas, HTML ni textos libres)", () => {
    for (const bad of ["?plantilla=../../admin", "?plantilla=<script>", "?plantilla=A", "?plantilla=", "?otra=cosa"]) {
      expect(captureTemplateIntent(bad), bad).toBeNull();
    }
    expect(peekTemplateIntent()).toBeNull();
  });

  it("vence a la semana, y un valor manipulado en el almacenamiento se descarta", () => {
    captureTemplateIntent("?plantilla=yoga-meditacion", 0);
    expect(peekTemplateIntent(7 * 24 * 60 * 60 * 1000 + 1)).toBeNull();
    window.localStorage.setItem("impulza-template-intent", JSON.stringify({ code: "javascript:alert(1)", at: Date.now() }));
    expect(peekTemplateIntent()).toBeNull();
    window.localStorage.setItem("impulza-template-intent", "{no es json");
    expect(peekTemplateIntent()).toBeNull();
  });
});
