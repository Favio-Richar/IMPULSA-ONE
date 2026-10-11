import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// Bloque «Rueda de trabajos»: se agrega desde el constructor con sus piezas administrables, y en la
// página publicada (build de producción, con su CSP) la rueda gira con el teclado y con los botones, sus
// enlaces funcionan y nada se desborda en teléfono ni en escritorio.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const CAPTURES = ".playwright/capturas/rueda";

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function blockIds(api: APIRequestContext): Promise<string[]> {
  return ((await (await api.get(blocksPath)).json()) as Array<{ id: string }>).map((block) => block.id);
}

test("en el constructor se agrega la rueda con piezas de muestra y el negocio edita el título", async ({ page }, testInfo) => {
  const before = new Set(await blockIds(page.request));
  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    const library = page.getByRole("region", { name: "Biblioteca de bloques" });
    const panel = page.getByRole("region", { name: "Configuración del bloque" });

    await library.getByRole("button", { name: "Rueda de trabajos" }).click();
    await expect(panel.getByLabel("Título de la rueda")).toHaveValue("Mis trabajos");
    // Piezas de muestra editables: mínimo 3.
    await expect(page.locator('[data-site-root] [role="listbox"] [role="option"]')).toHaveCount(4);
    await panel.getByLabel("Título de la rueda").fill("Portafolio 2026");
    await expect(panel.getByText("Guardado")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-site-root] section[aria-label="Portafolio 2026"]')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/constructor-${testInfo.project.name}.png` });
  } finally {
    for (const id of await blockIds(page.request)) {
      if (!before.has(id)) await page.request.delete(`${blocksPath}/${id}`, { headers: CSRF });
    }
  }
});

test.describe("página publicada", () => {
  let api: APIRequestContext;
  let blockId = "";

  async function revalidate(): Promise<void> {
    const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, { headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET }, data: { siteSlug: fixture.siteSlug } });
    expect(response.status()).toBe(200);
  }

  test.beforeAll(async () => {
    api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
    const piece = (n: number, extra: Record<string, unknown> = {}) => ({ title: `Obra ${n}`, image: { url: `https://cdn.ejemplo.cl/obra-${n}.jpg`, alt: `Fotografía de la obra ${n}` }, ...extra });
    const response = await api.post(blocksPath, {
      headers: CSRF,
      data: { type: "works_wheel", config: { label: "Obras destacadas", actionLabel: "Abrir", items: [piece(1, { link: "https://ejemplo.cl/obra-1" }), piece(2), piece(3), piece(4)] } },
    });
    expect(response.status(), await response.text()).toBe(201);
    blockId = ((await response.json()) as { id: string }).id;
    expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
    await revalidate();
  });

  test.afterAll(async () => {
    if (blockId) await api.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
    await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
    await revalidate();
    await api.dispose();
  });

  test("gira con el teclado y con los botones, el enlace funciona y no se desborda ni rompe la CSP", async ({ browser, viewport }, testInfo) => {
    const context = await browser.newContext({ viewport: viewport!, locale: "es-CL" });
    await context.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (event) => (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    // Las imágenes de muestra no existen: se sirven vacías para que la prueba no dependa de internet.
    await context.route(/cdn\.ejemplo\.cl/, (route) => route.fulfill({ status: 200, contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }));
    const page = await context.newPage();
    await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);

    const section = page.getByRole("region", { name: "Obras destacadas" });
    await expect(section).toBeVisible();
    const wheel = section.getByRole("listbox");
    await expect(wheel.getByRole("option")).toHaveCount(4);
    await expect(section.getByText("4 piezas")).toBeVisible();
    // La pieza con enlace es un enlace con su texto accesible; las demás no.
    await expect(section.getByRole("option", { name: "Obra 1: Abrir" })).toHaveAttribute("href", "https://ejemplo.cl/obra-1");
    await expect(section.locator("a[href]")).toHaveCount(1);

    // Teclado: el primer paso abre el tambor, el siguiente avanza de pieza.
    await wheel.focus();
    await page.keyboard.press("ArrowDown");
    await expect(section.getByText(/^1 \/ 4/)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(section.getByText(/^2 \/ 4 · Obra 2/)).toBeVisible();
    // Botones: tamaño táctil suficiente y mismo efecto.
    const next = section.getByRole("button", { name: "Pieza siguiente" });
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await next.click();
    await expect(section.getByText(/^3 \/ 4 · Obra 3/)).toBeVisible();
    await section.getByRole("button", { name: "Pieza anterior" }).click();
    await expect(section.getByText(/^2 \/ 4 · Obra 2/)).toBeVisible();

    await expectNoHorizontalScroll(page);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    await page.screenshot({ path: `${CAPTURES}/publicada-${testInfo.project.name}.png`, fullPage: true });
    await context.close();
  });
});
