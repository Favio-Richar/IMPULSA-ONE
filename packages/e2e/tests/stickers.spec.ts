import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import axe from "axe-core";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// Extra F10 — stickers y decoraciones, en teléfono y escritorio: se agregan desde la biblioteca del constructor eligiendo una del
// catálogo curado (con categorías y búsqueda), y en la página publicada son decorativos (ocultos a lectores de pantalla), con el
// tamaño, la rotación y la posición elegidos y sin desbordes. Un id fuera del catálogo se rechaza en el servidor.

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const CAPTURES = "../../docs/design/capturas/stickers";

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function blockIds(api: APIRequestContext): Promise<string[]> {
  return ((await (await api.get(blocksPath)).json()) as Array<{ id: string }>).map((block) => block.id);
}

test("en el constructor: se agrega, se busca y se elige una decoración, y se ajustan tamaño, posición y rotación", async ({ page }, testInfo) => {
  const before = new Set(await blockIds(page.request));
  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    const library = page.getByRole("region", { name: "Biblioteca de bloques" });
    const panel = page.getByRole("region", { name: "Configuración del bloque" });

    await library.getByRole("button", { name: "Sticker", exact: true }).click();
    await expect(panel.getByRole("group", { name: /Decoración/ })).toBeVisible({ timeout: 15_000 });
    // Categorías y búsqueda (sin tildes), con el conteo que se actualiza.
    await expect(panel.getByRole("group", { name: "Categorías de decoraciones" }).getByRole("button")).toHaveText(["Todas", "Flechas", "Formas", "Decorativos", "Sellos y textos"]);
    await panel.getByRole("group", { name: "Categorías de decoraciones" }).getByRole("button", { name: "Sellos y textos" }).click();
    await expect(panel.getByRole("button", { name: "Sello «Nuevo»" })).toBeVisible();
    await panel.getByRole("button", { name: "Todas" }).click();
    await panel.getByLabel("Buscar decoración").fill("corazon");
    await expect(panel.getByRole("list", { name: "Decoraciones" }).getByRole("button")).toHaveCount(1);
    await panel.getByRole("button", { name: "Corazón" }).click();
    await panel.getByLabel("Buscar decoración").fill("zzz-nada");
    await expect(panel.getByText(/Ninguna decoración coincide/)).toBeVisible();
    await panel.getByLabel("Buscar decoración").fill("");

    await panel.getByLabel("Tamaño").selectOption("lg");
    await panel.getByLabel("Posición").selectOption("right");
    await panel.getByLabel(/Rotación/).fill("-12");
    await expect(panel.getByText("Guardado")).toBeVisible({ timeout: 15_000 });

    const stored = (await (await page.request.get(blocksPath)).json()) as Array<{ id: string; type: string; config: Record<string, unknown> }>;
    const created = stored.find((block) => !before.has(block.id) && block.type === "sticker");
    expect(created?.config).toMatchObject({ stickerId: "corazon", size: "lg", alignment: "right", rotation: -12 });

    // En el lienzo se ve como una decoración (oculta a lectores de pantalla).
    await expect(page.locator('[data-site-root] [data-sticker="corazon"]')).toBeAttached();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/01-constructor-${testInfo.project.name}.png`, fullPage: true });
  } finally {
    for (const id of await blockIds(page.request)) {
      if (!before.has(id)) await page.request.delete(`${blocksPath}/${id}`, { headers: CSRF });
    }
  }
});

test.describe("página publicada", () => {
  let api: APIRequestContext;
  const created: string[] = [];

  async function revalidate(): Promise<void> {
    const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, { headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET }, data: { siteSlug: fixture.siteSlug } });
    expect(response.status()).toBe(200);
  }

  test.beforeAll(async () => {
    api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
    for (const config of [
      { stickerId: "sello-nuevo", size: "lg", rotation: -12, alignment: "right" },
      { stickerId: "flecha-curva", size: "md", rotation: 8, alignment: "left" },
      { stickerId: "subrayado-onda", size: "sm", rotation: 0, alignment: "center" },
    ]) {
      const response = await api.post(blocksPath, { headers: CSRF, data: { type: "sticker", config } });
      expect(response.status(), await response.text()).toBe(201);
      created.push(((await response.json()) as { id: string }).id);
    }
    expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
    await revalidate();
  });

  test.afterAll(async () => {
    for (const id of created) await api.delete(`${blocksPath}/${id}`, { headers: CSRF });
    await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
    await revalidate();
    await api.dispose();
  });

  test("se ve en el portal con tamaño, posición y rotación, decorativa y sin desbordes ni problemas de accesibilidad", async ({ browser, viewport }, testInfo) => {
    const context = await browser.newContext({ viewport: viewport!, locale: "es-CL" });
    const page = await context.newPage();
    await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);

    const seal = page.locator('[data-sticker="sello-nuevo"]');
    await expect(seal).toBeAttached({ timeout: 30_000 });
    // Decorativa: oculta a lectores de pantalla y sin nada enfocable.
    await expect(seal).toHaveAttribute("aria-hidden", "true");
    expect(await seal.evaluate((element) => element.querySelectorAll("a, button, [tabindex]").length)).toBe(0);
    // Tamaño grande, a la derecha y girado.
    const svg = seal.locator("svg");
    expect((await svg.boundingBox())!.width).toBeGreaterThan(150);
    expect(await seal.evaluate((element) => getComputedStyle(element).justifyContent)).toBe("flex-end");
    expect(await svg.evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
    // El texto del sello es del tema (no un color fijo) y no se lee como contenido: ningún lector lo anuncia.
    expect(await page.locator("body").ariaSnapshot()).not.toContain("NUEVO");

    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/02-portal-${testInfo.project.name}.png`, fullPage: true });

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return result.violations.map((violation) => ({ rule: violation.id, impact: violation.impact, nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) }));
    });
    expect(violations, JSON.stringify(violations, null, 1)).toEqual([]);
    await context.close();
  });
});

test("el servidor rechaza una decoración fuera del catálogo y valores fuera de rango", async () => {
  const api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  try {
    for (const config of [
      { stickerId: "logo-de-marca" },
      { stickerId: "https://ejemplo.cl/a.svg" },
      { stickerId: "estrella", rotation: 45 },
      { stickerId: "estrella", size: "xl" },
      { stickerId: "estrella", alignment: "arriba" },
    ]) {
      const response = await api.post(blocksPath, { headers: CSRF, data: { type: "sticker", config } });
      expect(response.status(), JSON.stringify(config)).toBe(422);
    }
  } finally {
    await api.dispose();
  }
});
