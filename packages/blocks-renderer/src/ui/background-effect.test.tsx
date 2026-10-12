import { renderToStaticMarkup } from "react-dom/server";
import { THEME_CATALOG } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { SiteBackdrop } from "./site-backdrop.js";

// Efecto de movimiento de una foto de fondo (F10): la foto lleva su clase de animación; sin efecto, ninguna.

const theme = THEME_CATALOG[0]!.tokens;
const media = "https://media.impulza.cl/org/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/w1600.webp";

function render(effect?: "kenburns" | "drift" | "parallax"): string {
  return renderToStaticMarkup(
    <SiteBackdrop theme={theme} background={{ kind: "image", image: { url: media }, overlay: { tone: "dark", strength: "strong" }, text: "light", ...(effect ? { effect } : {}) }}>
      <p>Contenido</p>
    </SiteBackdrop>,
  );
}

describe("efecto de movimiento de la foto de fondo", () => {
  it.each(["kenburns", "drift", "parallax"] as const)("«%s» agrega su clase a la foto", (effect) => {
    expect(render(effect)).toContain(`site-bg-${effect}`);
  });

  it("sin efecto la foto queda quieta, sin ninguna clase de animación", () => {
    expect(render()).not.toContain("site-bg-");
  });
});
