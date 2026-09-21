import { describe, expect, it } from "vitest";
import { resolveSeo } from "./seo-resolver.js";

const site = { name: "Panadería El Buen Pan" };
const homePage = { slug: "inicio", isHome: true };
const otherPage = { slug: "servicios", isHome: false };

describe("resolveSeo (F2.8)", () => {
  it("sin seoMeta ni bloques con texto, cae al nombre del sitio y sin descripción", () => {
    const seo = resolveSeo({
      site,
      page: homePage,
      seoMeta: null,
      blocks: [],
      canonicalOverridePath: null,
      selfPath: "/panaderia",
    });

    expect(seo.title).toBe("Panadería El Buen Pan");
    expect(seo.description).toBeUndefined();
    expect(seo.canonicalPath).toBe("/panaderia");
    expect(seo.robots).toBe("index_follow");
    expect(seo.openGraph).toEqual({ title: "Panadería El Buen Pan", description: undefined, image: undefined });
  });

  it("una página que no es home usa '<slug> · <sitio>' como título por defecto", () => {
    const seo = resolveSeo({
      site,
      page: otherPage,
      seoMeta: null,
      blocks: [],
      canonicalOverridePath: null,
      selfPath: "/panaderia/servicios",
    });
    expect(seo.title).toBe("servicios · Panadería El Buen Pan");
  });

  it("deriva el título del nombre del bloque de perfil, si hay uno", () => {
    const seo = resolveSeo({
      site,
      page: homePage,
      seoMeta: null,
      blocks: [{ type: "profile", config: { name: "Favio Jiménez" } }],
      canonicalOverridePath: null,
      selfPath: "/panaderia",
    });
    expect(seo.title).toBe("Favio Jiménez · Panadería El Buen Pan");
  });

  it("deriva el título del hero si no hay bloque de perfil", () => {
    const seo = resolveSeo({
      site,
      page: homePage,
      seoMeta: null,
      blocks: [{ type: "hero", config: { title: "Pan fresco cada mañana" } }],
      canonicalOverridePath: null,
      selfPath: "/panaderia",
    });
    expect(seo.title).toBe("Pan fresco cada mañana · Panadería El Buen Pan");
  });

  it("deriva la descripción del subtítulo del hero antes que de la bio del perfil", () => {
    const seo = resolveSeo({
      site,
      page: homePage,
      seoMeta: null,
      blocks: [
        { type: "hero", config: { title: "x", subtitle: "Pan artesanal todos los días." } },
        { type: "profile", config: { name: "x", bio: "<p>Bio del perfil</p>" } },
      ],
      canonicalOverridePath: null,
      selfPath: "/panaderia",
    });
    expect(seo.description).toBe("Pan artesanal todos los días.");
  });

  it("desnuda el HTML de un campo de texto enriquecido antes de usarlo como descripción", () => {
    const seo = resolveSeo({
      site,
      page: homePage,
      seoMeta: null,
      blocks: [{ type: "text", config: { html: "<p>Hola <strong>mundo</strong></p>" } }],
      canonicalOverridePath: null,
      selfPath: "/panaderia",
    });
    expect(seo.description).toBe("Hola mundo");
  });

  it("trunca una descripción larga en el último espacio antes del límite, con elipsis", () => {
    const long = "palabra ".repeat(40).trim();
    const seo = resolveSeo({
      site,
      page: homePage,
      seoMeta: null,
      blocks: [{ type: "text", config: { html: long } }],
      canonicalOverridePath: null,
      selfPath: "/panaderia",
    });
    expect(seo.description!.length).toBeLessThanOrEqual(200);
    expect(seo.description!.endsWith("…")).toBe(true);
    expect(seo.description!.endsWith(" …")).toBe(false);
  });

  it("un seoMeta explícito gana siempre sobre lo derivado del contenido", () => {
    const seo = resolveSeo({
      site,
      page: homePage,
      seoMeta: { title: "Título elegido a mano", description: "Descripción elegida a mano", robots: "noindex_follow" },
      blocks: [{ type: "hero", config: { title: "Se ignora", subtitle: "También se ignora" } }],
      canonicalOverridePath: null,
      selfPath: "/panaderia",
    });
    expect(seo.title).toBe("Título elegido a mano");
    expect(seo.description).toBe("Descripción elegida a mano");
    expect(seo.robots).toBe("noindex_follow");
  });

  it("Open Graph cae al título/descripción resueltos cuando no tiene los suyos propios", () => {
    const seo = resolveSeo({
      site,
      page: homePage,
      seoMeta: { title: "Mi título" },
      blocks: [],
      canonicalOverridePath: null,
      selfPath: "/panaderia",
    });
    expect(seo.openGraph.title).toBe("Mi título");
  });

  it("Open Graph con su propio título/descripción no hereda los de la página", () => {
    const seo = resolveSeo({
      site,
      page: homePage,
      seoMeta: { title: "Título de la página", openGraph: { title: "Título solo para compartir" } },
      blocks: [],
      canonicalOverridePath: null,
      selfPath: "/panaderia",
    });
    expect(seo.openGraph.title).toBe("Título solo para compartir");
  });

  it("un canonical resuelto (override válido) gana sobre la ruta propia", () => {
    const seo = resolveSeo({
      site,
      page: otherPage,
      seoMeta: { canonicalPageSlug: "inicio" },
      blocks: [],
      canonicalOverridePath: "/panaderia",
      selfPath: "/panaderia/servicios",
    });
    expect(seo.canonicalPath).toBe("/panaderia");
  });

  it("sin override (o uno huérfano ya descartado antes de llamar), el canonical es la ruta propia", () => {
    const seo = resolveSeo({
      site,
      page: otherPage,
      seoMeta: {},
      blocks: [],
      canonicalOverridePath: null,
      selfPath: "/panaderia/servicios",
    });
    expect(seo.canonicalPath).toBe("/panaderia/servicios");
  });
});
