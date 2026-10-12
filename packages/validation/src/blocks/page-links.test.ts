import { describe, expect, it } from "vitest";
import { heroSchema, linkSchema, showcaseSchema } from "./catalog.js";
import { linkTargetSchema, pageNavLabel, pageSlugFromLink, resolvePageLinks } from "./primitives.js";

// Enlaces internos: un botón o tarjeta puede llevar a otra página del mismo sitio con `page:<slug>`.

describe("enlace a una página del sitio", () => {
  it("acepta una URL https o una referencia de página, y nada más", () => {
    expect(linkTargetSchema.safeParse("https://ejemplo.cl/a").success).toBe(true);
    expect(linkTargetSchema.safeParse("page:album").success).toBe(true);
    expect(linkTargetSchema.safeParse("page:perfil-modelo").success).toBe(true);
    // Lo que entrega el render público después de resolver `page:<slug>`.
    expect(linkTargetSchema.safeParse("/mi-sitio/album").success).toBe(true);
    expect(linkTargetSchema.safeParse("/mi-sitio").success).toBe(true);
    for (const bad of ["page:", "page:Album", "page:../admin", "page:a/b", "javascript:alert(1)", "//evil.example", "/a/b/c", "/../admin", "/album?x=1", "album", "data:text/html,x"]) {
      expect(linkTargetSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("lo aceptan los botones, las colecciones y los botones de acción de la portada", () => {
    expect(linkSchema.safeParse({ label: "Álbum", url: "page:album" }).success).toBe(true);
    expect(heroSchema.safeParse({ title: "Hola", cta: { label: "Ver", url: "page:servicios" } }).success).toBe(true);
    expect(showcaseSchema.safeParse({ items: [{ title: "Álbum", image: { url: "https://cdn.ejemplo.cl/a.jpg", alt: "x" }, link: "page:album" }] }).success).toBe(true);
  });

  it("extrae el slug solo de una referencia exacta", () => {
    expect(pageSlugFromLink("page:album")).toBe("album");
    expect(pageSlugFromLink("page:album ")).toBe("album");
    expect(pageSlugFromLink("https://ejemplo.cl/page:album")).toBeNull();
    expect(pageSlugFromLink(42)).toBeNull();
  });

  it("la página de inicio se enlaza a la raíz del sitio", () => {
    expect(resolvePageLinks({ url: "page:inicio", other: "page:album" }, "mi-sitio", "inicio")).toEqual({ url: "/mi-sitio", other: "/mi-sitio/album" });
  });

  it("el render convierte cada referencia en la ruta pública, a cualquier profundidad, sin tocar lo demás", () => {
    const config = { url: "page:album", items: [{ link: "page:perfil" }, { link: "https://ejemplo.cl/x" }], label: "page:no-es-un-enlace-exacto extra" };
    expect(resolvePageLinks(config, "mi-sitio")).toEqual({
      url: "/mi-sitio/album",
      items: [{ link: "/mi-sitio/perfil" }, { link: "https://ejemplo.cl/x" }],
      label: "page:no-es-un-enlace-exacto extra",
    });
  });
});

describe("nombre de una página en el menú", () => {
  it("usa «Inicio» para la principal, nombres con acento para las conocidas y el slug en forma de título para el resto", () => {
    expect(pageNavLabel("inicio", true)).toBe("Inicio");
    expect(pageNavLabel("album", false)).toBe("Álbum");
    expect(pageNavLabel("musica", false)).toBe("Música");
    expect(pageNavLabel("mi-nueva-pagina", false)).toBe("Mi nueva pagina");
  });
});
