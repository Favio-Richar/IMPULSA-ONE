import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// PP4 — familias de temas y encabezado de perfil, contra la API y el panel reales: aplicar un tema
// Ejecutivo desde el panel y ver su pareja tipográfica en el constructor (servida desde el propio
// origen, nunca desde un tercero), y el encabezado con portada, avatar montado y fila de redes.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const blocksPath = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}/pages/${fixture.pageId}/blocks`;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function applyTheme(page: Page, group: string, name: string): Promise<void> {
  await page.goto(`/sitios/${fixture.siteId}`);
  const section = page.getByRole("region", { name: group });
  const card = section.getByRole("button", { name: new RegExp(`^${name}`) });
  // Si ya es el actual, el botón está deshabilitado y no hay nada que aplicar.
  if (await card.isEnabled()) {
    await card.click();
  }
  await expect(card.getByText("Actual")).toBeVisible({ timeout: 10_000 });
}

test("un tema Ejecutivo cambia la tipografía de los títulos, con fuentes alojadas en el propio sitio", async ({ page }) => {
  await applyTheme(page, "Ejecutivo", "Marino");
  // Las cuatro líneas del catálogo aparecen agrupadas.
  for (const group of ["Ejecutivo", "Vibrante", "Clásicos"]) {
    await expect(page.getByRole("region", { name: group })).toBeVisible();
  }
  await expectNoHorizontalScroll(page);

  await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
  const title = page.locator("[data-site-root]").getByRole("heading", { name: "Bienvenido a Impulza" });
  await expect(title).toBeVisible();
  await expect.poll(() => title.evaluate((element) => getComputedStyle(element).fontFamily)).toContain("Source Serif 4 Variable");
  const paragraph = page.locator("[data-site-root]").getByText("Un párrafo de ejemplo para el lienzo.");
  await expect.poll(() => paragraph.evaluate((element) => getComputedStyle(element).fontFamily)).toContain("Inter Variable");

  // La fuente de verdad llegó (no solo quedó declarada) y vino del mismo origen que la página.
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 32px "Source Serif 4 Variable"', "Bienvenido");
  });
  expect(loaded).toBe(true);
  const fontOrigins = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => url.endsWith(".woff2"))
      .map((url) => new URL(url).origin),
  );
  expect(fontOrigins.length).toBeGreaterThan(0);
  expect(new Set(fontOrigins)).toEqual(new Set([new URL(page.url()).origin]));

  // Se deja el sitio con el tema por defecto para el resto de las pruebas.
  await applyTheme(page, "Clásicos", "Claro profesional");
});

test("encabezado de perfil: portada, avatar montado sobre ella y redes con tamaño de toque", async ({ page }) => {
  // `.invalid` nunca resuelve: la prueba no sale a internet y mide el layout, no la foto.
  const created = await page.request.post(blocksPath, {
    headers: CSRF,
    data: {
      type: "profile",
      config: {
        name: "Estudio Ejemplo",
        headline: "Arquitectura y diseño interior",
        avatar: { url: "https://example.invalid/avatar.jpg", alt: "Logo del estudio" },
        cover: { url: "https://example.invalid/portada.jpg", alt: "Fachada del estudio" },
        verified: true,
        socials: [
          { network: "instagram", url: "https://instagram.com/estudio" },
          { network: "tiktok", url: "https://tiktok.com/@estudio" },
          { network: "whatsapp", url: "https://wa.me/56912345678" },
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  const blockId = ((await created.json()) as { id: string }).id;

  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    const site = page.locator("[data-site-root]");
    const cover = site.locator("[data-profile-cover]");
    const avatar = site.getByRole("img", { name: "Logo del estudio" });
    await expect(cover).toBeVisible();
    await expect(avatar).toBeVisible();

    const coverBox = (await cover.boundingBox())!;
    const avatarBox = (await avatar.boundingBox())!;
    // El avatar cruza el borde inferior de la portada y queda centrado sobre ella.
    expect(avatarBox.y).toBeLessThan(coverBox.y + coverBox.height);
    expect(avatarBox.y + avatarBox.height).toBeGreaterThan(coverBox.y + coverBox.height);
    expect(Math.abs(avatarBox.x + avatarBox.width / 2 - (coverBox.x + coverBox.width / 2))).toBeLessThanOrEqual(2);

    const socials = site.getByRole("navigation", { name: "Redes de Estudio Ejemplo" }).getByRole("link");
    await expect(socials).toHaveCount(3);
    for (const link of await socials.all()) {
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(coverBox.x + coverBox.width + 1);
    }
    await expect(site.getByLabel("Perfil verificado")).toBeVisible();
    await expectNoHorizontalScroll(page);
  } finally {
    await page.request.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
  }
});

test("portada de cuerpo entero (PL7): la foto es la cabecera y el nombre queda debajo, nunca encima", async ({ page }) => {
  const created = await page.request.post(blocksPath, {
    headers: CSRF,
    data: {
      type: "profile",
      config: {
        name: "Estudio Portada",
        headline: "Fotografía de retrato",
        cover: { url: "https://example.invalid/retrato.jpg", alt: "Retrato de cuerpo entero" },
        verified: false,
        layout: "hero",
      },
    },
  });
  expect(created.status()).toBe(201);
  const blockId = ((await created.json()) as { id: string }).id;

  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    const site = page.locator("[data-site-root]");
    const hero = site.locator("[data-profile-hero]");
    const heading = site.getByRole("heading", { name: "Estudio Portada" });
    await expect(hero).toBeVisible();
    await expect(heading).toBeVisible();

    const heroBox = (await hero.boundingBox())!;
    const headingBox = (await heading.boundingBox())!;
    // Alto de retrato o cuadrada: nunca una franja apaisada.
    expect(heroBox.height).toBeGreaterThanOrEqual(heroBox.width - 1);
    // El texto empieza donde termina la foto: su contraste no depende de la imagen.
    expect(headingBox.y).toBeGreaterThanOrEqual(heroBox.y + heroBox.height - 1);
    // Sin avatar redondo en esta variante.
    await expect(site.locator("[data-profile-monogram]")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  } finally {
    await page.request.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
  }
});

test("tema Minimal (PL7): los botones de la pila van todos con la superficie neutra, sin color primario", async ({ page }) => {
  await applyTheme(page, "Minimal", "Perla");
  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    const site = page.locator("[data-site-root]");
    const button = site.locator('[data-block-type="link"] a').first();
    await expect(button).toBeVisible();
    // `surface` de Perla (#f4f4f5), no el primario (#18181b).
    await expect(button).toHaveCSS("background-color", "rgb(244, 244, 245)");
    await expectNoHorizontalScroll(page);
  } finally {
    await applyTheme(page, "Clásicos", "Claro profesional");
  }
});

test("compartir (PL8): el botón junto a un enlace copia su dirección y lo anuncia", async ({ page, context, browserName }) => {
  // Sin hoja de compartir del sistema (en Windows o en un teléfono abriría un diálogo nativo): se
  // prueba el camino de copiar, que es el que tiene cualquier navegador.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  const created = await page.request.post(blocksPath, {
    headers: CSRF,
    data: { type: "link", config: { label: "Mi portafolio compartible", url: "https://example.com/portafolio", style: "secondary", shareable: true } },
  });
  expect(created.status()).toBe(201);
  const blockId = ((await created.json()) as { id: string }).id;

  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    const site = page.locator("[data-site-root]");
    const share = site.getByRole("button", { name: "Compartir Mi portafolio compartible" });
    await expect(share).toBeVisible();

    // Queda dentro del botón de la pila, a la derecha, con tamaño de toque suficiente.
    const link = site.getByRole("link", { name: /Mi portafolio compartible/ });
    const linkBox = (await link.boundingBox())!;
    const shareBox = (await share.boundingBox())!;
    expect(shareBox.width).toBeGreaterThanOrEqual(40);
    expect(shareBox.x + shareBox.width).toBeLessThanOrEqual(linkBox.x + linkBox.width);
    expect(shareBox.x).toBeGreaterThan(linkBox.x + linkBox.width / 2);

    await share.click();
    await expect(site.locator("[data-share-status]").filter({ hasText: "Enlace copiado" })).toHaveCount(1);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://example.com/portafolio");
    await expectNoHorizontalScroll(page);
  } finally {
    await page.request.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
  }
});
