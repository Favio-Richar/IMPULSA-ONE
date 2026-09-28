import { describe, expect, it } from "vitest";
import { getCatalogTheme } from "../themes/catalog.js";
import { evaluatePageHealth, HEALTH_PENALTY, type PageHealthBlock, type PageHealthInput } from "./index.js";

const NOW = new Date("2026-09-27T12:00:00Z");
const THEME = getCatalogTheme("claro-profesional")!.tokens;
const FORM_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";

let nextId = 0;
function block(type: string, config: unknown, extra: Partial<PageHealthBlock> = {}): PageHealthBlock {
  nextId += 1;
  return {
    id: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    type,
    configSchemaVersion: type === "contact_form" ? 2 : 1,
    visible: true,
    isPrimary: false,
    scheduledEnd: null,
    config,
    ...extra,
  };
}

const profile = () => block("profile", { name: "Estudio Lumen", headline: "Fotografía de producto", verified: false });
const whatsapp = (extra: Partial<PageHealthBlock> = {}) =>
  block("whatsapp", { phone: "+56912345678", label: "Escríbenos" }, { isPrimary: true, ...extra });

function input(blocks: PageHealthBlock[], overrides: Partial<PageHealthInput> = {}): PageHealthInput {
  return {
    page: { isHome: true, status: "PUBLISHED", visibility: "PUBLIC", seoMeta: null, hasUnpublishedChanges: false },
    blocks,
    themeTokens: THEME,
    resources: {
      existingFormIds: new Set([FORM_ID]),
      activeServiceIds: new Set([SERVICE_ID]),
      activeProducts: [{ id: PRODUCT_ID, categoryId: null }],
      publishedPageSlugs: new Set(["inicio", "servicios"]),
    },
    now: NOW,
    ...overrides,
  };
}

const codes = (report: ReturnType<typeof evaluatePageHealth>) => report.findings.map((finding) => finding.code);

describe("salud de página (F6.1)", () => {
  it("una página publicada con encabezado y acción principal tiene 100 y ningún hallazgo", () => {
    const report = evaluatePageHealth(input([profile(), whatsapp()]));
    expect(report).toEqual({ score: 100, findings: [] });
  });

  it("sin publicar y vacía son críticos; el puntaje resta por severidad y nunca baja de 0", () => {
    const report = evaluatePageHealth(
      input([], { page: { isHome: true, status: "DRAFT", visibility: "PUBLIC", seoMeta: null, hasUnpublishedChanges: true } }),
    );
    expect(codes(report)).toEqual(expect.arrayContaining(["page_not_published", "page_empty"]));
    // Sin publicar no suma además "cambios sin publicar": sería contar dos veces lo mismo.
    expect(codes(report)).not.toContain("unpublished_changes");
    expect(report.findings.every((finding, i, all) => i === 0 || severityRank(all[i - 1]!.severity) <= severityRank(finding.severity))).toBe(true);
    expect(report.score).toBe(Math.max(0, 100 - report.findings.reduce((sum, f) => sum + HEALTH_PENALTY[f.severity], 0)));
  });

  it("cambios sin publicar en una página publicada son informativos", () => {
    const report = evaluatePageHealth(
      input([profile(), whatsapp()], { page: { isHome: true, status: "PUBLISHED", visibility: "PUBLIC", seoMeta: null, hasUnpublishedChanges: true } }),
    );
    expect(report.findings).toEqual([{ code: "unpublished_changes", severity: "info", category: "publication" }]);
    expect(report.score).toBe(98);
  });

  it("sin ningún bloque de acción es crítico; con acciones pero ninguna principal, informativo", () => {
    expect(codes(evaluatePageHealth(input([profile(), block("text", { html: "<p>Hola</p>", alignment: "left" })])))).toContain("no_action");
    expect(codes(evaluatePageHealth(input([profile(), whatsapp({ isPrimary: false })])))).toEqual(["no_primary_action"]);
  });

  it("sin perfil ni portada avisa que falta el encabezado y que el título SEO será genérico", () => {
    const report = evaluatePageHealth(input([whatsapp()]));
    expect(codes(report)).toEqual(expect.arrayContaining(["no_heading", "seo_title_generic", "seo_description_missing"]));
  });

  it("el SEO escrito a mano cuenta aunque no haya de dónde derivarlo", () => {
    const report = evaluatePageHealth(
      input([whatsapp()], {
        page: { isHome: true, status: "PUBLISHED", visibility: "PUBLIC", seoMeta: { title: "Lumen", description: "Fotos de producto" }, hasUnpublishedChanges: false },
      }),
    );
    expect(codes(report)).not.toContain("seo_title_generic");
    expect(codes(report)).not.toContain("seo_description_missing");
  });

  it("inicio con noindex y canonical a una página que no existe son advertencias de SEO", () => {
    const report = evaluatePageHealth(
      input([profile(), whatsapp()], {
        page: { isHome: true, status: "PUBLISHED", visibility: "PUBLIC", seoMeta: { robots: "noindex_follow", canonicalPageSlug: "borrada" }, hasUnpublishedChanges: false },
      }),
    );
    expect(codes(report)).toEqual(["seo_home_noindex", "seo_canonical_missing"]);
  });

  it("un bloque que no se puede mostrar es crítico y no se analiza más", () => {
    const broken = block("link", { label: "Sin URL" });
    const future = block("whatsapp", { phone: "+56912345678" }, { configSchemaVersion: 99 });
    const report = evaluatePageHealth(input([profile(), whatsapp(), broken, future]));
    expect(report.findings.filter((f) => f.code === "block_unrenderable").map((f) => f.blockId)).toEqual([broken.id, future.id]);
  });

  it("formulario sin configurar o apuntando a un formulario borrado es crítico", () => {
    const empty = block("contact_form", { formId: null });
    const deleted = block("contact_form", { formId: "44444444-4444-4444-8444-444444444444" });
    const ok = block("contact_form", { formId: FORM_ID });
    const report = evaluatePageHealth(input([profile(), whatsapp(), empty, deleted, ok]));
    expect(report.findings.filter((f) => f.code === "form_not_configured").map((f) => f.blockId)).toEqual([empty.id, deleted.id]);
  });

  it("reservas y catálogo sin nada activo que ofrecer son críticos, respetando la selección del bloque", () => {
    const bookingAll = block("booking", { label: "Reservar" });
    const bookingOther = block("booking", { serviceIds: ["55555555-5555-4555-8555-555555555555"] });
    const catalogAll = block("catalog", {});
    const catalogCategory = block("catalog", { categoryId: "66666666-6666-4666-8666-666666666666" });
    const report = evaluatePageHealth(input([profile(), whatsapp(), bookingAll, bookingOther, catalogAll, catalogCategory]));
    expect(report.findings.filter((f) => f.code === "booking_without_services").map((f) => f.blockId)).toEqual([bookingOther.id]);
    expect(report.findings.filter((f) => f.code === "catalog_without_products").map((f) => f.blockId)).toEqual([catalogCategory.id]);

    const none = evaluatePageHealth(
      input([profile(), whatsapp(), bookingAll], {
        resources: { existingFormIds: new Set(), activeServiceIds: new Set(), activeProducts: [], publishedPageSlugs: new Set() },
      }),
    );
    expect(codes(none)).toContain("booking_without_services");
  });

  it("imágenes sin texto alternativo cuentan por bloque; las decorativas no", () => {
    const gallery = block("gallery", {
      images: [
        { url: "https://cdn.x.cl/1.jpg", alt: "" },
        { url: "https://cdn.x.cl/2.jpg", alt: "", decorative: true },
        { url: "https://cdn.x.cl/3.jpg", alt: " " },
      ],
    });
    const report = evaluatePageHealth(input([profile(), whatsapp(), gallery]));
    expect(report.findings).toEqual([{ code: "image_alt_missing", severity: "warning", category: "accessibility", blockId: gallery.id, blockType: "gallery", count: 2 }]);
  });

  it("enlaces http:// y enlaces repetidos se señalan sin pedir nunca la URL", () => {
    const insecure = block("link", { label: "Blog", url: "http://blog.x.cl" });
    const first = block("link", { label: "Tienda", url: "https://tienda.x.cl/" });
    const repeated = block("link", { label: "Compra", url: "https://TIENDA.x.cl" });
    const social = block("social", { links: [{ network: "instagram", url: "http://instagram.com/x" }] });
    const report = evaluatePageHealth(input([profile(), whatsapp(), insecure, first, repeated, social]));
    expect(report.findings.filter((f) => f.code === "insecure_link").map((f) => f.blockId)).toEqual([insecure.id, social.id]);
    expect(report.findings.filter((f) => f.code === "duplicate_link").map((f) => f.blockId)).toEqual([repeated.id]);
  });

  it("los bloques ocultos o con programación vencida no cuentan como contenido", () => {
    const hidden = block("contact_form", { formId: null }, { visible: false });
    const ended = block("link", { label: "Promo", url: "https://x.cl" }, { scheduledEnd: new Date("2026-09-01T00:00:00Z") });
    const report = evaluatePageHealth(input([profile(), whatsapp(), hidden, ended]));
    expect(report.findings).toEqual([{ code: "block_schedule_ended", severity: "info", category: "content", blockId: ended.id, blockType: "link" }]);
  });

  it("demasiados videos o bloques bajan la nota de rendimiento", () => {
    const videos = Array.from({ length: 4 }, () => block("video", { video: { provider: "youtube", videoId: "dQw4w9WgXcQ" } }));
    const dividers = Array.from({ length: 22 }, () => block("divider", {}));
    const report = evaluatePageHealth(input([profile(), whatsapp(), ...videos, ...dividers]));
    expect(codes(report)).toEqual(["heavy_media", "too_many_blocks"]);
  });

  it("un tema guardado que ya no cumple AA es crítico", () => {
    const report = evaluatePageHealth(
      input([profile(), whatsapp()], {
        themeTokens: { ...THEME, palette: { ...THEME.palette, mutedForeground: THEME.palette.background } },
      }),
    );
    expect(report.findings).toEqual([{ code: "theme_contrast", severity: "critical", category: "accessibility" }]);
  });
});

function severityRank(severity: string): number {
  return ["critical", "warning", "info"].indexOf(severity);
}
