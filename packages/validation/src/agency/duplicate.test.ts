import { describe, expect, it } from "vitest";
import {
  clearBlockReferences,
  DUPLICATE_NOT_COPIED,
  duplicateClientSchema,
  prepareBackground,
  prepareBlockForDuplicate,
  prepareSeoMeta,
  referencesOrganizationMedia,
  remapSmartCta,
  reviewHintsFor,
  stripSourceMedia,
} from "../index.js";

const SOURCE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const ASSET = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const sourceImage = (name = "foto") => ({ url: `https://cdn.ejemplo.test/org/${SOURCE}/${ASSET}/w1600.webp`, alt: name });
const externalImage = { url: "https://images.ejemplo.test/externa.jpg", alt: "Externa" };
const prepare = (type: string, config: unknown, schemaVersion = 1) => prepareBlockForDuplicate({ type, schemaVersion, config, sourceOrganizationId: SOURCE });

describe("duplicar — qué es un medio del cliente origen", () => {
  it("solo cuenta la ruta de ESA organización, sin importar mayúsculas", () => {
    expect(referencesOrganizationMedia(`https://x.test/org/${SOURCE}/a/w400.webp`, SOURCE)).toBe(true);
    expect(referencesOrganizationMedia(`https://x.test/branding/org/${SOURCE.toUpperCase()}/logo.png`, SOURCE)).toBe(true);
    expect(referencesOrganizationMedia(`https://x.test/org/${OTHER}/a/w400.webp`, SOURCE)).toBe(false);
    expect(referencesOrganizationMedia("https://youtu.be/abc", SOURCE)).toBe(false);
    // El identificador suelto, sin ser una ruta de almacenamiento, no es un archivo del origen.
    expect(referencesOrganizationMedia(`un texto con ${SOURCE} adentro`, SOURCE)).toBe(false);
  });

  it("quita imágenes del origen en cualquier profundidad y conserva las externas", () => {
    const result = stripSourceMedia({ titulo: "Hola", images: [sourceImage("a"), externalImage, sourceImage("b")], extra: { fondo: sourceImage() } }, SOURCE);
    // `extra` quedó vacío solo porque se le quitó su imagen: se descarta, y no cuenta como una imagen más.
    expect(result.value).toEqual({ titulo: "Hola", images: [externalImage] });
    expect(result.removed).toBe(3);
  });

  it("en texto enriquecido quita solo la etiqueta del medio del origen y deja el texto", () => {
    const html = `<p>Antes</p><img src="https://cdn.test/org/${SOURCE}/${ASSET}/w800.webp" alt="x"><img src="https://otro.test/ok.png" alt="ok"><p>Después</p>`;
    const result = stripSourceMedia({ html }, SOURCE);
    expect(result.value).toEqual({ html: '<p>Antes</p><img src="https://otro.test/ok.png" alt="ok"><p>Después</p>' });
    expect(result.removed).toBe(1);
  });

  it("un texto plano que apunta al origen se descarta como propiedad; uno normal no se toca", () => {
    const result = stripSourceMedia({ poster: `https://cdn.test/org/${SOURCE}/${ASSET}/w400.webp`, nombre: "Café del sol" }, SOURCE);
    expect(result.value).toEqual({ nombre: "Café del sol" });
    expect(stripSourceMedia({ nombre: "Café" }, SOURCE).removed).toBe(0);
  });

  it("un objeto que ya venía vacío se respeta; uno que solo tenía medios del origen se descarta", () => {
    expect(stripSourceMedia({ a: {}, b: "x" }, SOURCE).value).toEqual({ a: {}, b: "x" });
    expect(stripSourceMedia({ og: { image: `https://cdn.test/org/${SOURCE}/${ASSET}/w400.webp` }, t: "x" }, SOURCE)).toEqual({ value: { t: "x" }, removed: 1 });
    expect(stripSourceMedia({ fondo: sourceImage() }, SOURCE)).toEqual({ value: undefined, removed: 1 });
  });

  it("no muta la entrada", () => {
    const input = { images: [sourceImage()] };
    const copy = JSON.parse(JSON.stringify(input));
    stripSourceMedia(input, SOURCE);
    expect(input).toEqual(copy);
  });
});

describe("duplicar — bloques", () => {
  it("un hero con fondo del origen se copia sin el fondo", () => {
    const result = prepare("hero", { title: "Bienvenidos", alignment: "center", background: sourceImage() });
    expect(result).toMatchObject({ outcome: "copied", imagesRemoved: 1, referencesCleared: 0 });
    if (result.outcome === "copied") expect(result.config).not.toHaveProperty("background");
  });

  it("una galería se queda con las imágenes externas; si todas eran del origen, el bloque no se copia", () => {
    const some = prepare("gallery", { images: [sourceImage(), externalImage], layout: "grid" });
    expect(some).toMatchObject({ outcome: "copied", imagesRemoved: 1 });
    if (some.outcome === "copied") expect(some.config.images).toEqual([externalImage]);
    expect(prepare("gallery", { images: [sourceImage(), sourceImage("b")], layout: "grid" })).toEqual({ outcome: "skipped", reason: "invalid_after_cleanup" });
  });

  it("un bloque de imagen cuya imagen es del origen no se copia a medias", () => {
    expect(prepare("image", { image: sourceImage(), caption: "Nuestro local" })).toEqual({ outcome: "skipped", reason: "invalid_after_cleanup" });
    expect(prepare("image", { image: externalImage })).toMatchObject({ outcome: "copied" });
  });

  it("el formulario, los servicios y los productos del origen quedan sin configurar", () => {
    const form = prepare("contact_form", { title: "Escríbenos", formId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f" });
    expect(form).toMatchObject({ outcome: "copied", referencesCleared: 1 });
    if (form.outcome === "copied") expect(form.config).toEqual({ title: "Escríbenos", formId: null });

    const booking = prepare("booking", { label: "Reservar hora", serviceIds: ["0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f"] });
    expect(booking).toMatchObject({ outcome: "copied", referencesCleared: 1 });
    if (booking.outcome === "copied") expect(booking.config).toEqual({ label: "Reservar hora" });

    const catalog = prepare("catalog", { label: "Tienda", productIds: ["0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f"], categoryId: "1f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f" });
    expect(catalog).toMatchObject({ outcome: "copied", referencesCleared: 2 });
    if (catalog.outcome === "copied") expect(catalog.config).toEqual({ label: "Tienda" });
  });

  it("clearBlockReferences no toca los demás bloques y no cuenta lo que no había", () => {
    expect(clearBlockReferences("hero", { title: "x" })).toEqual({ config: { title: "x" }, cleared: 0 });
    expect(clearBlockReferences("contact_form", { formId: null })).toEqual({ config: { formId: null }, cleared: 0 });
    expect(clearBlockReferences("catalog", { label: "Tienda" })).toEqual({ config: { label: "Tienda" }, cleared: 0 });
  });

  it("un tipo desconocido, una versión futura o una configuración inválida no se copian", () => {
    expect(prepare("tipo_que_no_existe", {})).toEqual({ outcome: "skipped", reason: "unknown_type" });
    expect(prepare("hero", { title: "x", alignment: "center" }, 99)).toEqual({ outcome: "skipped", reason: "future_version" });
    expect(prepare("hero", { alignment: "center" })).toEqual({ outcome: "skipped", reason: "invalid_after_cleanup" });
    expect(prepare("hero", null)).toEqual({ outcome: "skipped", reason: "invalid_after_cleanup" });
    expect(prepare("hero", [])).toEqual({ outcome: "skipped", reason: "invalid_after_cleanup" });
  });

  it("lo que no tiene nada del origen se copia idéntico", () => {
    const config = { label: "Visítanos", url: "https://ejemplo.test", style: "primary" };
    const result = prepare("link", config);
    expect(result).toEqual({ outcome: "copied", config, imagesRemoved: 0, referencesCleared: 0 });
  });
});

describe("duplicar — SEO, fondo y Smart CTA", () => {
  it("el SEO conserva textos y canonical pero pierde la imagen del origen", () => {
    const result = prepareSeoMeta({ title: "Inicio", description: "Todo", canonicalPageSlug: "inicio", openGraph: { image: `https://cdn.test/org/${SOURCE}/${ASSET}/w1600.webp` } }, SOURCE);
    expect(result.imagesRemoved).toBe(1);
    expect(result.value).toMatchObject({ title: "Inicio", description: "Todo", canonicalPageSlug: "inicio" });
    expect(prepareSeoMeta(null, SOURCE)).toEqual({ value: null, imagesRemoved: 0 });
    expect(prepareSeoMeta({ title: "Solo texto" }, SOURCE)).toEqual({ value: { title: "Solo texto" }, imagesRemoved: 0 });
  });

  it("el fondo se descarta si usa un archivo del origen y se conserva si es un color o degradado", () => {
    expect(prepareBackground({ kind: "image", image: { url: `https://cdn.test/org/${SOURCE}/${ASSET}/w1600.webp` } }, SOURCE)).toEqual({ value: null, imagesRemoved: 1 });
    const gradient = { kind: "gradient", from: "#000000", to: "#ffffff" };
    expect(prepareBackground(gradient, SOURCE)).toEqual({ value: gradient, imagesRemoved: 0 });
    expect(prepareBackground(null, SOURCE)).toEqual({ value: null, imagesRemoved: 0 });
  });

  it("las reglas del Smart CTA se rehacen con los ids nuevos y se descartan las que apuntaban a un bloque no copiado", () => {
    const keep = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
    const gone = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
    const fresh = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
    const rules = { rules: [{ condition: { kind: "device", device: "mobile" }, blockId: keep }, { condition: { kind: "outside_hours" }, blockId: gone }] };
    const result = remapSmartCta(rules, new Map([[keep, fresh]]));
    expect(result).toEqual({ value: { rules: [{ condition: { kind: "device", device: "mobile" }, blockId: fresh }] }, kept: 1, dropped: 1 });
    // Ningún id del bloque origen sobrevive en la copia.
    expect(JSON.stringify(result.value)).not.toContain(keep);
    expect(JSON.stringify(result.value)).not.toContain(gone);
    // Si todas las reglas apuntaban a bloques que no se copiaron, no queda Smart CTA.
    expect(remapSmartCta(rules, new Map()).value).toBeNull();
    expect(remapSmartCta(null, new Map())).toEqual({ value: null, kept: 0, dropped: 0 });
  });
});

describe("duplicar — cuerpo e informe", () => {
  const body = { name: "Cliente copia", slug: "cliente-copia", ownerEmail: "Dueno@Negocio.cl", idempotencyKey: "clave-unica-123" };

  it("pide los datos del cliente nuevo y una clave de idempotencia válida", () => {
    expect(duplicateClientSchema.parse(body)).toMatchObject({ ownerEmail: "dueno@negocio.cl", billingMode: "CLIENT_PAYS", idempotencyKey: "clave-unica-123" });
    for (const bad of [{ ...body, idempotencyKey: "corta" }, { ...body, idempotencyKey: "con espacios y más" }, { ...body, idempotencyKey: "x".repeat(101) }, { ...body, slug: "NO VALIDO" }, { ...body, ownerEmail: "no-correo" }]) {
      expect(duplicateClientSchema.safeParse(bad).success).toBe(false);
    }
    const withoutKey = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "idempotencyKey"));
    expect(duplicateClientSchema.safeParse(withoutKey).success).toBe(false);
  });

  it("la lista de lo que no se copia incluye lo que el backlog prohíbe", () => {
    const text = DUPLICATE_NOT_COPIED.join(" | ").toLowerCase();
    for (const forbidden of ["contactos", "pedidos", "pagos", "cuentas de cobro", "claves", "imágenes y videos", "medición"]) expect(text).toContain(forbidden);
  });

  it("las sugerencias de revisión no se repiten y siguen el orden de los bloques", () => {
    expect(reviewHintsFor(["hero", "whatsapp", "whatsapp", "map", "contact_actions"])).toEqual(["Números de WhatsApp", "Dirección del mapa", "Correo y teléfono de contacto"]);
    expect(reviewHintsFor(["hero", "text", "link"])).toEqual([]);
  });
});
