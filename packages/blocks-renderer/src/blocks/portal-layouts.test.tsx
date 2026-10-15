import { gallerySchema, showcaseSchema } from "@impulza/validation";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GalleryBlock } from "./gallery.js";
import { ShowcaseBlock } from "./showcase.js";

// Diseños de bloques existentes que adaptan componentes de 21st.dev (editor de portales): la esfera de la galería y el índice de
// la vitrina. En el servidor (y sin JavaScript) tienen que mostrar todo el contenido, accesible, sin depender de la animación.

const photo = (n: number) => ({ url: `https://images.unsplash.com/photo-${n}?w=800`, alt: `Foto de ejemplo ${n}` });

describe("galería en esfera (sphere)", () => {
  const config = gallerySchema.parse({ layout: "sphere", images: [photo(1), photo(2), photo(3)] });

  it("el esquema acepta el diseño y sin él sigue siendo cuadrícula", () => {
    expect(config.layout).toBe("sphere");
    expect(gallerySchema.parse({ images: [photo(1)] }).layout).toBe("grid");
    expect(gallerySchema.safeParse({ layout: "cubo", images: [photo(1)] }).success).toBe(false);
  });

  it("en el servidor muestra la cuadrícula con todas las fotos y su texto alternativo (sin JavaScript nada se pierde)", () => {
    const html = renderToStaticMarkup(<GalleryBlock config={config} />);
    expect(html).toContain('data-gallery-sphere="fallback"');
    for (const n of [1, 2, 3]) expect(html).toContain(`alt="Foto de ejemplo ${n}"`);
    // Nada aleatorio en el render inicial: dos renders iguales (sin diferencias de hidratación).
    expect(renderToStaticMarkup(<GalleryBlock config={config} />)).toBe(html);
  });
});

describe("vitrina en índice (index)", () => {
  const config = showcaseSchema.parse({
    title: "Discografía",
    layout: "index",
    actionLabel: "Escuchar",
    items: [
      { title: "Tu primer disco", subtitle: "Álbum", badge: "2025", image: photo(10), link: "page:album" },
      { title: "Sencillo de ejemplo", image: photo(11), link: "page:album" },
    ],
  });

  it("cada fila es un enlace con su nombre completo; los textos visibles quedan fuera del árbol accesible", () => {
    const html = renderToStaticMarkup(<ShowcaseBlock config={config} />);
    expect(html).toContain('data-showcase-index=""');
    expect(html).toContain('aria-label="Discografía"');
    expect(html).toContain('aria-label="Tu primer disco, Álbum, 2025: Escuchar"');
    expect(html).toContain('aria-label="Sencillo de ejemplo: Escuchar"');
    expect(html.match(/href="page:album"/g)).toHaveLength(2);
    // En reposo, el texto es el de la página (sin velo) y el velo está apagado.
    expect(html).toContain("text-[var(--site-color-foreground)]");
    expect(html).toMatch(/bg-black\/\[0\.78\][^"]*opacity-0/);
  });

  it("las portadas de fondo y las miniaturas son decorativas (alt vacío): la fila ya nombra la pieza", () => {
    const html = renderToStaticMarkup(<ShowcaseBlock config={config} />);
    expect(html).not.toContain('alt="Foto de ejemplo 10"');
    expect(html.match(/alt=""/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("los otros diseños de la vitrina no cambian", () => {
    const html = renderToStaticMarkup(<ShowcaseBlock config={{ ...config, layout: "stack" }} />);
    expect(html).not.toContain("data-showcase-index");
    expect(html).toContain("aspect-[16/10]");
  });
});
