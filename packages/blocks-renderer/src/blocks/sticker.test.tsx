import { renderToStaticMarkup } from "react-dom/server";
import { STICKER_CATALOG, stickerSchema } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { StickerBlock } from "./sticker.js";

describe("bloque sticker (extra F10)", () => {
  it("es decorativo: oculto a lectores de pantalla, sin foco y sin texto alternativo", () => {
    const html = renderToStaticMarkup(<StickerBlock config={stickerSchema.parse({ stickerId: "estrella" })} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/tabindex|<a |<button|<img|<title|alt=/i);
  });

  it("pinta con los colores del tema y respeta tamaño, rotación y alineación", () => {
    const html = renderToStaticMarkup(<StickerBlock config={stickerSchema.parse({ stickerId: "sello-nuevo", size: "lg", rotation: -12, alignment: "right" })} />);
    expect(html).toContain("var(--site-color-primary)");
    expect(html).toContain("var(--site-color-primary-foreground)");
    expect(html).toContain("width:160px");
    expect(html).toContain("rotate(-12deg)");
    expect(html).toContain("justify-content:flex-end");
    expect(html).toContain("NUEVO");
    // El texto del sello se ajusta a su ancho: no se sale de la forma.
    expect(html).toContain("textLength");
  });

  it("todo sticker del catálogo se dibuja sin errores y sin colores fijos ni marcado inyectado", () => {
    for (const sticker of STICKER_CATALOG) {
      const html = renderToStaticMarkup(<StickerBlock config={stickerSchema.parse({ stickerId: sticker.id })} />);
      expect(html, sticker.id).toContain("<svg");
      expect(html, sticker.id).not.toMatch(/#[0-9a-f]{3,6}\b|<script|javascript:|dangerouslySetInnerHTML/i);
    }
  });

  it("un id que ya no existe no pinta nada (en vez de romper la página)", () => {
    expect(renderToStaticMarkup(<StickerBlock config={{ stickerId: "ya-no-existe", size: "md", rotation: 0, alignment: "center", color: "primary" }} />)).toBe("");
  });
});
