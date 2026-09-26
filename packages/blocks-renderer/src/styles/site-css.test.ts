import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(import.meta.dirname, "site.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("site.css — entrada de los bloques (PP5)", () => {
  it("la animación solo existe cuando el visitante no pidió reducir el movimiento", () => {
    const guarded = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? "";
    expect(guarded).toContain("animation: site-block-enter");
    // Fuera de ese bloque, ninguna regla aplica la animación.
    const unguarded = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\}\s*$/, "");
    expect(unguarded).not.toMatch(/animation\s*:/);
  });

  it("nunca parte de opacidad 0, que sacaría a la foto de perfil del cálculo del LCP", () => {
    const from = /@keyframes site-block-enter \{\s*from \{([^}]*)\}/.exec(css)?.[1] ?? "";
    const opacity = Number(/opacity:\s*([\d.]+)/.exec(from)?.[1]);
    expect(opacity).toBeGreaterThan(0);
  });

  it("la portada va a sangre solo en una columna de teléfono, y toca el borde superior si el perfil es lo primero (PL5)", () => {
    const narrow = /@container \(max-width: 39\.999rem\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(narrow).toContain("[data-profile-cover]");
    expect(narrow).toMatch(/margin-inline:\s*-1rem/);
    expect(narrow).toMatch(/\[data-block-type="profile"\]:first-child \[data-profile-cover\][^}]*margin-top:\s*-2\.5rem/);
  });
});

