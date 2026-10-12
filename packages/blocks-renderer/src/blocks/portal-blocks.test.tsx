import { renderToStaticMarkup } from "react-dom/server";
import { albumSchema, featureSchema, pageHeaderSchema, statsSchema, stepsSchema } from "@impulza/validation";
import { describe, expect, it } from "vitest";
import { AlbumBlock } from "./album.js";
import { FeatureBlock } from "./feature.js";
import { PageHeaderBlock } from "./page-header.js";
import { StatsBlock } from "./stats.js";
import { StepsBlock } from "./steps.js";

// Bloques de portal profesional (F10): lo que el servidor pinta de cada uno. El visor del álbum y sus filtros
// se montan en el navegador (se verifican con Playwright); acá, estructura accesible y texto.

const photo = (n: number, extra: Record<string, unknown> = {}) => ({ image: { url: `https://cdn.ejemplo.cl/${n}.jpg`, alt: `Foto ${n}` }, ...extra });

describe("álbum", () => {
  const config = albumSchema.parse({
    title: "Todas las series",
    photos: Array.from({ length: 14 }, (_, index) => photo(index + 1, { title: `Obra ${index + 1}`, category: index % 2 === 0 ? "Retrato" : "Moda" })),
  });
  const html = renderToStaticMarkup(<AlbumBlock config={config} />);

  it("muestra los filtros por categoría, cada foto como botón accesible y carga solo las primeras 12", () => {
    expect(html).toContain('aria-label="Filtrar fotos por categoría"');
    expect(html).toContain(">Todas<");
    expect(html).toContain(">Retrato<");
    expect(html).toContain(">Moda<");
    expect(html.match(/aria-label="Ver foto: Obra \d+"/g)).toHaveLength(12);
    expect(html).toContain("Ver más fotos (2)");
  });

  it("los botones tienen área táctil suficiente y no hay visor abierto de entrada", () => {
    expect(html).toContain("min-h-11");
    expect(html).not.toContain('role="dialog"');
  });

  it("sin categorías no hay filtros", () => {
    const plain = albumSchema.parse({ photos: [photo(1), photo(2)] });
    expect(renderToStaticMarkup(<AlbumBlock config={plain} />)).not.toContain("Filtrar fotos por categoría");
  });
});

describe("encabezado, cifras, pasos e imagen y texto", () => {
  it("el encabezado es el h1 de la página, con rótulo y bajada", () => {
    const html = renderToStaticMarkup(<PageHeaderBlock config={pageHeaderSchema.parse({ eyebrow: "Portafolio", title: "Álbum completo", subtitle: "Mis series" })} />);
    expect(html).toContain("<h1");
    expect(html).toContain("Álbum completo");
    expect(html).toContain("Portafolio");
  });

  it("las cifras son una lista de definiciones", () => {
    const html = renderToStaticMarkup(<StatsBlock config={statsSchema.parse({ items: [{ value: "+300", label: "sesiones" }, { value: "9", label: "años" }] })} />);
    expect(html).toContain("<dl");
    expect(html).toContain("+300");
    expect(html).toContain("sesiones");
  });

  it("los pasos son una lista ordenada con el número también para el lector de pantalla", () => {
    const html = renderToStaticMarkup(<StepsBlock config={stepsSchema.parse({ items: [{ title: "Conversamos", description: "Primero" }, { title: "Entrego", description: "Después" }] })} />);
    expect(html).toContain("<ol");
    expect(html).toContain("Paso 1: ");
    expect(html).toContain("Conversamos");
  });

  it("imagen y texto: el texto enriquecido pasa por el saneo y el botón es un enlace", () => {
    const config = featureSchema.parse({
      image: { url: "https://cdn.ejemplo.cl/a.jpg", alt: "Retrato" },
      title: "Mi historia",
      text: '<p>Hola <script>alert(1)</script></p>',
      cta: { label: "Reservar", url: "page:contacto" },
    });
    const html = renderToStaticMarkup(<FeatureBlock config={config} />);
    expect(html).not.toContain("<script");
    expect(html).toContain("Mi historia");
    expect(html).toContain('href="page:contacto"');
  });
});
