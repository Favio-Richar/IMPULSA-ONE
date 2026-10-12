import { describe, expect, it } from "vitest";
import { getCatalogTheme } from "../themes/catalog.js";
import { TEMPLATE_CATALOG } from "./catalog.js";
import { templateSchema, type TemplateIndustry } from "./index.js";

// PL3 — criterios de aceptación del catálogo semilla, verificados sobre el catálogo real.

describe("TEMPLATE_CATALOG (PL3)", () => {
  it("tiene al menos 6 plantillas, todas válidas contra el mismo esquema que usa el seed", () => {
    expect(TEMPLATE_CATALOG.length).toBeGreaterThanOrEqual(6);
    for (const template of TEMPLATE_CATALOG) {
      const result = templateSchema.safeParse(template);
      expect(result.success, `${template.code}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it("no repite códigos ni orden de galería", () => {
    expect(new Set(TEMPLATE_CATALOG.map((template) => template.code)).size).toBe(TEMPLATE_CATALOG.length);
    expect(new Set(TEMPLATE_CATALOG.map((template) => template.sortOrder)).size).toBe(TEMPLATE_CATALOG.length);
  });

  it("cubre los seis rubros pedidos (segmentos de PM §4)", () => {
    const required: [string, TemplateIndustry[]][] = [
      ["Profesional/Servicios", ["profesional"]],
      ["Café/Gastronomía", ["gastronomia"]],
      ["Comercio/Retail", ["comercio"]],
      ["Creador/Personal", ["creador"]],
      ["Salud/Bienestar", ["salud", "belleza-bienestar"]],
      ["Eventos/Turismo", ["eventos", "turismo"]],
      ["Educación/Talleres (F8.4)", ["educacion"]],
    ];
    for (const [segment, industries] of required) {
      const covered = TEMPLATE_CATALOG.some((template) => industries.every((tag) => template.industryTags.includes(tag)));
      expect(covered, segment).toBe(true);
    }
  });

  it("las plantillas nuevas de F8.4 usan bloques enriquecidos del sistema", () => {
    const academia = TEMPLATE_CATALOG.find((t) => t.code === "academia-talleres")!;
    const fitness = TEMPLATE_CATALOG.find((t) => t.code === "fitness-entrenamiento")!;
    const musico = TEMPLATE_CATALOG.find((t) => t.code === "musico-banda")!;
    const restaurante = TEMPLATE_CATALOG.find((t) => t.code === "restaurante-menu")!;

    expect(academia).toBeDefined();
    expect(fitness).toBeDefined();
    expect(musico).toBeDefined();
    expect(restaurante).toBeDefined();

    // El portal completo (F10) reparte los bloques entre el inicio y sus páginas compañeras.
    const portalTypes = (template: (typeof TEMPLATE_CATALOG)[number]) => [
      ...template.blocksSeed.map((b) => b.type),
      ...(template.companionPages ?? []).flatMap((page) => page.blocksSeed.map((b) => b.type)),
    ];
    const academiaTypes = portalTypes(academia);
    expect(academiaTypes).toContain("events");
    expect(academiaTypes).toContain("newsletter");

    const fitnessTypes = portalTypes(fitness);
    expect(fitnessTypes).toContain("booking");
    expect(fitnessTypes).toContain("pricing");

    const musicoTypes = portalTypes(musico);
    expect(musicoTypes).toContain("music");
    expect(musicoTypes).toContain("events");
    expect(musicoTypes).toContain("video");

    const restauranteTypes = portalTypes(restaurante);
    expect(restauranteTypes).toContain("catalog");
    expect(restauranteTypes).toContain("map");
  });

  it("la plantilla de creador usa un tema de la línea oscura (PL2)", () => {
    const creator = TEMPLATE_CATALOG.find((template) => template.industryTags.includes("creador"));
    expect(creator && getCatalogTheme(creator.themeCode)?.family).toBe("oscuro");
  });

  describe.each(TEMPLATE_CATALOG.map((template) => [template.code, template] as const))("%s", (_code, template) => {
    const types = template.blocksSeed.map((block) => block.type);

    it("empieza con el perfil, con frase y bio marcadas como ejemplo", () => {
      expect(types[0]).toBe("profile");
      const config = template.blocksSeed[0]!.config as { name: string; headline?: string; bio?: string };
      expect(config.headline).toBeTruthy();
      expect(config.bio).toMatch(/ejemplo/i);
    });

    it("trae 1-2 bloques de enlace/WhatsApp, uno como acción principal", () => {
      const actions = types.filter((type) => type === "link" || type === "whatsapp");
      expect(actions.length).toBeGreaterThanOrEqual(1);
      expect(actions.length).toBeLessThanOrEqual(2);
      expect(template.blocksSeed.filter((block) => block.isPrimary)).toHaveLength(1);
    });

    it("trae un servicio o una galería y la fila de redes", () => {
      expect(["service", "gallery", "showcase", "album", "works_wheel", "catalog", "booking"].some((type) => types.includes(type))).toBe(true);
      expect(types).toContain("social");
    });

    it("no trae formularios sin conectar ni imágenes de terceros", () => {
      expect(types).not.toContain("contact_form");
      expect(JSON.stringify(template.blocksSeed)).not.toMatch(/"(url|src)":"https?:\/\/(?!example\.com\/|www\.(instagram|facebook|tiktok|youtube|linkedin)\.com\/"|open\.spotify\.com\/"|images\.unsplash\.com\/photo-)/);
    });

    it("no nombra a Linktree, Beacons ni Stan", () => {
      const text = JSON.stringify(template).toLowerCase();
      expect(text).not.toMatch(/linktree|linktr\.ee|beacons|\bstan\b|stan\.store/);
    });
  });
});

describe("portales completos: cada botón de una plantilla lleva a una página real (F10)", () => {
  /** Todos los `page:<slug>` que aparecen en cualquier valor de la configuración (a cualquier profundidad). */
  function pageRefs(value: unknown, found = new Set<string>()): Set<string> {
    if (typeof value === "string") {
      const match = /^page:([a-z0-9-]+)$/.exec(value);
      if (match) found.add(match[1]!);
    } else if (Array.isArray(value)) {
      for (const item of value) pageRefs(item, found);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) pageRefs(item, found);
    }
    return found;
  }

  for (const template of TEMPLATE_CATALOG) {
    describe(template.code, () => {
      const companions = template.companionPages ?? [];
      const slugs = new Set(companions.map((page) => page.slug));

      it("trae a lo sumo 2 páginas compañeras (con la de inicio, 3: lo que admite el plan gratis)", () => {
        expect(companions.length).toBeLessThanOrEqual(2);
      });

      it("todo enlace interno de la plantilla apunta a una de sus páginas compañeras", () => {
        const refs = new Set<string>();
        pageRefs(template.blocksSeed, refs);
        for (const page of companions) pageRefs(page.blocksSeed, refs);
        for (const ref of refs) expect(slugs.has(ref), `${template.code}: page:${ref} no existe`).toBe(true);
      });

      it("ninguna página compañera deja a la persona sin salida: cada una trae una acción (WhatsApp, enlace, formulario…)", () => {
        for (const page of companions) {
          expect(page.blocksSeed.some((block) => ["whatsapp", "link", "contact_actions", "booking", "newsletter", "service", "catalog", "social"].includes(block.type)), page.slug).toBe(true);
        }
      });

      it("no trae botones que lleven a sitios de ejemplo inexistentes (solo la web propia de la plantilla de fotografía)", () => {
        const text = JSON.stringify([template.blocksSeed, ...companions.map((page) => page.blocksSeed)]);
        const dead = [...text.matchAll(/"(?:url|link|ticketUrl)":"(https:\/\/example\.com\/[^"]*)"/g)].map((match) => match[1]);
        const allowed = template.code === "fotografia-moda" ? ["https://example.com/mi-sitio-web"] : [];
        expect(dead.filter((url) => !allowed.includes(url!))).toEqual([]);
      });
    });
  }
});
