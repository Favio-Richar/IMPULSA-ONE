import { renderToStaticMarkup } from "react-dom/server";
import { worksWheelSchema } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { WorksWheelBlock } from "./works-wheel.js";

// El servidor pinta la estructura accesible (lista de piezas, enlaces, controles); la animación
// 3D la escribe el navegador, así que acá se verifica lo que no depende de medir la escena.

const config = worksWheelSchema.parse({
  label: "Portafolio",
  actionLabel: "Abrir",
  items: [
    { title: "Casa Lago", image: { url: "https://cdn.ejemplo.cl/1.jpg", alt: "Fachada de la casa" }, link: "https://ejemplo.cl/casa-lago" },
    { title: "Café Sur", image: { url: "https://cdn.ejemplo.cl/2.jpg", alt: "", decorative: true } },
    { title: "Oficina Norte", image: { url: "https://cdn.ejemplo.cl/3.jpg", alt: "Oficina con luz natural" } },
  ],
});

describe("rueda de trabajos (render del servidor)", () => {
  const html = renderToStaticMarkup(<WorksWheelBlock config={config} />);

  it("expone la sección con su nombre y una lista de opciones navegable por teclado", () => {
    expect(html).toContain('aria-label="Portafolio"');
    expect(html).toContain('role="listbox"');
    expect(html.match(/role="option"/g)).toHaveLength(3);
    expect(html).toContain('tabindex="0"');
  });

  it("las piezas con enlace son enlaces con el texto accesible configurado; las demás no lo son", () => {
    expect(html).toContain('href="https://ejemplo.cl/casa-lago"');
    expect(html).toContain('aria-label="Casa Lago: Abrir"');
    expect(html).toContain('rel="nofollow"');
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("las imágenes decorativas llevan alt vacío y las demás su descripción", () => {
    expect(html).toContain('alt="Fachada de la casa"');
    expect(html).toContain('alt=""');
  });

  it("trae botones de anterior y siguiente con área táctil suficiente, sin depender del arrastre", () => {
    expect(html).toContain('aria-label="Pieza anterior"');
    expect(html).toContain('aria-label="Pieza siguiente"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("3 piezas");
  });

  it("no deja que el gesto vertical de la página se pierda en el teléfono (pan-y)", () => {
    expect(html).toContain("touch-action:pan-y");
  });

  it("un nombre con marcado se escapa: nunca se interpreta como HTML", () => {
    const hostile = worksWheelSchema.parse({
      items: [1, 2, 3].map((n) => ({ title: n === 1 ? "<img src=x onerror=alert(1)>" : `Trabajo ${n}`, image: { url: `https://cdn.ejemplo.cl/${n}.jpg`, alt: `Imagen ${n}` }, link: "https://ejemplo.cl" })),
    });
    const markup = renderToStaticMarkup(<WorksWheelBlock config={hostile} />);
    expect(markup).not.toContain("<img src=x");
    expect(markup).toContain("&lt;img src=x");
  });
});
