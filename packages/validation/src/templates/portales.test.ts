import { describe, expect, it } from "vitest";
import { TEMPLATE_CATALOG } from "./catalog.js";
import { TEMPLATE_INDUSTRIES, templateSchema } from "./index.js";

// Editor de portales: reglas que valen para TODAS las plantillas del catálogo (las 13 base y las nuevas).

/** Plantillas cuyo rubro vive de una comunidad: llevan botón «Suscribirme». El resto (servicios, negocios locales) no. */
const WITH_SUBSCRIBE = new Set([
  // Base
  "creador-personal",
  "fotografia-moda",
  "portada-minimal",
  "academia-talleres",
  "fitness-entrenamiento",
  "musico-banda",
  // Nuevas
  "streaming-gaming",
  "video-corto-creador",
  "youtuber-canal",
  "contenido-suscripcion",
  "clases-particulares",
  "musica-podcast",
  "coaching-fitness",
  "yoga-meditacion",
  "academia-deportiva",
]);

const allPages = (template: (typeof TEMPLATE_CATALOG)[number]) => [
  { slug: "inicio", blocks: template.blocksSeed },
  ...(template.companionPages ?? []).map((page) => ({ slug: page.slug, blocks: page.blocksSeed })),
];

/** Todos los destinos `page:<slug>` de una configuración, a cualquier profundidad. */
function pageTargets(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string" && value.startsWith("page:")) found.push(value.slice(5));
  else if (Array.isArray(value)) value.forEach((item) => pageTargets(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => pageTargets(item, found));
  return found;
}

describe("plantillas del catálogo (editor de portales)", () => {
  it("son 41: las 13 base y 28 nuevas, todas válidas contra el esquema del seed", () => {
    expect(TEMPLATE_CATALOG).toHaveLength(41);
    for (const template of TEMPLATE_CATALOG) {
      const result = templateSchema.safeParse(template);
      expect(result.success, `${template.code}: ${JSON.stringify(result.error?.issues.slice(0, 3))}`).toBe(true);
    }
  });

  it("en todas, el inicio empieza con el perfil y justo debajo las vistas y «me gusta»", () => {
    for (const template of TEMPLATE_CATALOG) {
      expect(template.blocksSeed[0]?.type, template.code).toBe("profile");
      expect(template.blocksSeed[1]?.type, template.code).toBe("engagement");
      expect(template.blocksSeed[1]?.config, template.code).toMatchObject({ showViews: true, showLikes: true });
    }
  });

  it("el botón «Suscribirme» aparece solo en los rubros de comunidad, nunca en servicios o negocios locales", () => {
    for (const template of TEMPLATE_CATALOG) {
      const hasSubscribe = allPages(template).some((page) => page.blocks.some((block) => block.type === "subscribe"));
      expect(hasSubscribe, template.code).toBe(WITH_SUBSCRIBE.has(template.code));
    }
  });

  it("todo botón hacia `page:<slug>` lleva a una página que la plantilla crea (navegación sin enlaces rotos)", () => {
    for (const template of TEMPLATE_CATALOG) {
      const slugs = new Set((template.companionPages ?? []).map((page) => page.slug));
      for (const page of allPages(template)) {
        for (const target of pageTargets(page.blocks)) {
          expect(slugs.has(target), `${template.code} › ${page.slug} → page:${target}`).toBe(true);
        }
      }
    }
  });

  it("las nuevas son portales completos: dos páginas internas, una acción principal en el inicio y rubros existentes", () => {
    const base = 13;
    for (const template of TEMPLATE_CATALOG.slice(base)) {
      expect(template.companionPages, template.code).toHaveLength(2);
      expect(template.blocksSeed.filter((block) => block.isPrimary).length, template.code).toBe(1);
      for (const tag of template.industryTags) expect(TEMPLATE_INDUSTRIES, template.code).toContain(tag);
    }
    // Las fotos de ejemplo salen siempre de Unsplash (licencia libre), nunca de otro servidor.
    const urls = JSON.stringify(TEMPLATE_CATALOG).match(/https:\/\/[^"]+\.(?:jpg|png|webp)|https:\/\/images\.[^"]+/g) ?? [];
    for (const url of urls) expect(url.startsWith("https://images.unsplash.com/"), url).toBe(true);
  });
});
