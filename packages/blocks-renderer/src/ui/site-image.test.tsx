import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteImage } from "./site-image.js";

const media = "https://media.impulza.cl/org/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/w1600.webp";

describe("SiteImage (PP2)", () => {
  it("una imagen de la biblioteca se sirve con srcset y carga perezosa", () => {
    const html = renderToStaticMarkup(<SiteImage image={{ url: media, alt: "Nuestro local" }} />);
    expect(html).toContain('srcSet="');
    expect(html).toContain("w400.webp 400w");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt="Nuestro local"');
  });

  it("la imagen principal se pide primero y con prioridad", () => {
    const html = renderToStaticMarkup(<SiteImage image={{ url: media, alt: "Portada" }} priority sizes="100vw" />);
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain('sizes="100vw"');
  });

  it("una URL externa se usa tal cual, y una decorativa no se anuncia", () => {
    const html = renderToStaticMarkup(<SiteImage image={{ url: "https://ejemplo.com/foto.jpg", alt: "x", decorative: true }} />);
    expect(html).not.toContain("srcSet");
    expect(html).toContain('alt=""');
  });
});
