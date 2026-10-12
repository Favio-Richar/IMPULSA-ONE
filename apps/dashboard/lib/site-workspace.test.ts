import { describe, expect, it } from "vitest";
import { buildWorkspaceAreas, summarizePublication, type WorkspacePage } from "./site-workspace";

const home: WorkspacePage = {
  id: "p-home",
  slug: "inicio",
  isHome: true,
  status: "PUBLISHED",
  blocks: [
    { type: "profile", visible: true },
    { type: "album", visible: true },
    { type: "album", visible: false },
    { type: "booking", visible: true },
  ],
};
const second: WorkspacePage = { id: "p-2", slug: "servicios", isHome: false, status: "DRAFT", blocks: [{ type: "pricing", visible: true }, { type: "gallery", visible: true }] };

describe("Mi sistema — áreas administrables (F10)", () => {
  it("cuenta solo bloques visibles y abre el editor de la página que los contiene", () => {
    const areas = buildWorkspaceAreas("s1", [home, second]);
    const photos = areas.find((area) => area.id === "photos")!;
    expect(photos).toMatchObject({ count: 2, state: "ok", href: "/sitios/s1/paginas/p-home/editor" });
    const services = areas.find((area) => area.id === "services")!;
    expect(services).toMatchObject({ count: 1, state: "ok", href: "/sitios/s1/paginas/p-2/editor" });
  });

  it("las áreas con pantalla propia llevan a ella, y lo que falta se sugiere desde el inicio", () => {
    const areas = buildWorkspaceAreas("s1", [home, second]);
    expect(areas.find((area) => area.id === "booking")).toMatchObject({ state: "ok", href: "/sitios/s1/reservas" });
    expect(areas.find((area) => area.id === "shop")).toMatchObject({ state: "suggest", count: 0, href: "/sitios/s1/catalogo" });
    expect(areas.find((area) => area.id === "videos")).toMatchObject({ state: "suggest", href: "/sitios/s1/paginas/p-home/editor" });
  });

  it("primero lo que ya tiene contenido, después lo sugerido", () => {
    const states = buildWorkspaceAreas("s1", [home, second]).map((area) => area.state);
    expect(states.indexOf("suggest")).toBeGreaterThan(states.lastIndexOf("ok"));
  });

  it("un sitio sin páginas no falla", () => {
    const areas = buildWorkspaceAreas("s1", []);
    expect(areas.every((area) => area.state === "suggest")).toBe(true);
    expect(areas.find((area) => area.id === "photos")!.href).toBe("/sitios/s1");
  });

  it("resume cuántas páginas están publicadas", () => {
    expect(summarizePublication([home, second])).toEqual({ total: 2, published: 1, drafts: 1 });
  });
});

describe("Mi sistema — cursos (F10.3)", () => {
  it("muestra el área de cursos solo si se conoce el conteo, y la sugiere cuando es 0", () => {
    expect(buildWorkspaceAreas("s1", [home]).some((area) => area.id === "courses")).toBe(false);
    expect(buildWorkspaceAreas("s1", [home], { courses: null }).some((area) => area.id === "courses")).toBe(false);
    expect(buildWorkspaceAreas("s1", [home], { courses: 0 }).find((area) => area.id === "courses")).toMatchObject({ state: "suggest", count: 0, href: "/sitios/s1/cursos" });
    expect(buildWorkspaceAreas("s1", [home], { courses: 2 }).find((area) => area.id === "courses")).toMatchObject({ state: "ok", count: 2 });
  });
});
