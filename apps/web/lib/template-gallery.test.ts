import { describe, expect, it } from "vitest";
import {
  blocksSummary,
  filterTemplates,
  galleryHref,
  hasActiveFilters,
  industriesInCatalog,
  pageWindow,
  paginate,
  parseGalleryQuery,
  templateHasSubscription,
  templatePageCount,
} from "./template-gallery";

const block = (type: string, config: unknown = {}) => ({ type, configSchemaVersion: 1, config });
const tpl = (code: string, name: string, industryTags: string[], withSubscribe: boolean) =>
  ({
    code,
    name,
    description: `Plantilla de ejemplo ${name}`,
    industryTags,
    blocks: [block("profile"), block("engagement")],
    companionPages: [{ slug: "contacto", blocks: withSubscribe ? [block("subscribe")] : [block("whatsapp")] }],
  }) as never;

const CATALOG = [
  tpl("clinica-dental", "Clínica dental", ["salud", "belleza-bienestar"], false),
  tpl("musica-podcast", "Música y podcast", ["musica-podcast", "creador"], true),
  tpl("yoga-meditacion", "Yoga y meditación", ["salud", "fitness-coaching"], true),
  tpl("taller-mecanico", "Taller mecánico", ["servicios-locales"], false),
];

describe("galería pública de plantillas", () => {
  it("lee los filtros de la dirección e ignora valores desconocidos o maliciosos", () => {
    expect(parseGalleryQuery({ rubro: "salud", suscripcion: "con", q: "  yoga ", pagina: "2" })).toEqual({ rubro: "salud", suscripcion: "con", q: "yoga", pagina: 2 });
    expect(parseGalleryQuery({ rubro: "<script>", suscripcion: "quizas", pagina: "-3" })).toEqual({ rubro: null, suscripcion: "todas", q: "", pagina: 1 });
    expect(parseGalleryQuery({ pagina: ["4", "9"], q: "x".repeat(200) }).q).toHaveLength(60);
    expect(hasActiveFilters(parseGalleryQuery({ pagina: "3" }))).toBe(false);
    expect(hasActiveFilters(parseGalleryQuery({ suscripcion: "sin" }))).toBe(true);
  });

  it("detecta la suscripción en cualquier página y cuenta las páginas", () => {
    expect(templateHasSubscription(CATALOG[1]!)).toBe(true);
    expect(templateHasSubscription(CATALOG[0]!)).toBe(false);
    expect(templatePageCount(CATALOG[0]!)).toBe(2);
  });

  it("filtra por rubro, suscripción y texto (sin tildes ni mayúsculas, también por la etiqueta del rubro)", () => {
    const q = (extra: Record<string, string>) => filterTemplates(CATALOG, parseGalleryQuery(extra)).map((t: { code: string }) => t.code);
    expect(q({ rubro: "salud" })).toEqual(["clinica-dental", "yoga-meditacion"]);
    expect(q({ rubro: "salud", suscripcion: "con" })).toEqual(["yoga-meditacion"]);
    expect(q({ suscripcion: "sin" })).toEqual(["clinica-dental", "taller-mecanico"]);
    expect(q({ q: "MUSICA" })).toEqual(["musica-podcast"]);
    expect(q({ q: "negocios locales" })).toEqual(["taller-mecanico"]);
    expect(q({ q: "nada-coincide" })).toEqual([]);
  });

  it("pagina de a 9 y una página fuera de rango cae en la última", () => {
    const items = Array.from({ length: 41 }, (_, i) => i);
    expect(paginate(items, 1)).toMatchObject({ page: 1, totalPages: 5, total: 41 });
    expect(paginate(items, 1).items).toHaveLength(9);
    expect(paginate(items, 5).items).toEqual([36, 37, 38, 39, 40]);
    expect(paginate(items, 99).page).toBe(5);
    expect(paginate([], 3)).toEqual({ items: [], page: 1, totalPages: 1, total: 0 });
  });

  it("arma direcciones cortas que conservan los filtros", () => {
    const query = parseGalleryQuery({ rubro: "salud", suscripcion: "con", q: "yoga" });
    expect(galleryHref(query, { pagina: 2 })).toBe("/plantillas?rubro=salud&suscripcion=con&q=yoga&pagina=2");
    expect(galleryHref(parseGalleryQuery({}))).toBe("/plantillas");
    expect(galleryHref(query, { rubro: null, suscripcion: "todas", q: "", pagina: 1 })).toBe("/plantillas");
  });

  it("la ventana de páginas muestra extremos, vecinas y saltos", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
    expect(pageWindow(1, 12)).toEqual([1, 2, null, 12]);
  });

  it("solo ofrece rubros que tienen plantillas, y resume los bloques sin repetir", () => {
    expect(industriesInCatalog(CATALOG)).toEqual(["servicios-locales", "belleza-bienestar", "salud", "creador", "musica-podcast", "fitness-coaching"]);
    expect(blocksSummary([block("page_header"), block("booking"), block("service"), block("service"), block("gallery", { layout: "sphere" })])).toEqual([
      "reservas en línea",
      "servicios con precio",
      "galería en esfera 3D",
    ]);
  });
});
