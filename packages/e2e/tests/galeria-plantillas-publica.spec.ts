import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// Galería pública de plantillas del sitio comercial (build de producción): filtros por rubro, suscripción y texto en la dirección,
// paginación de 9, una página por plantilla con sus tres páginas en vivo y SEO propio, y el puente al panel con la plantilla ya
// elegida (`?plantilla=`).

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/galeria-plantillas";

async function audit(page: Page, label: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((violation) => ({
      rule: violation.id,
      nodes: violation.nodes.slice(0, 3).map((node) => ({ target: node.target.join(" "), data: node.any[0]?.data ?? null })),
    }));
  });
  expect(violations, `${label}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

// Solo las tarjetas (hijos directos de la lista): cada tarjeta trae además su propia lista de datos.
const cards = (page: Page) => page.locator('ul[aria-label^="Plantillas, página"] > li');

test("la galería muestra 9 por página y pagina con enlaces reales que conservan los filtros", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/plantillas`);
  await expect(page.getByRole("heading", { name: "Galería de plantillas" })).toBeVisible();
  await expect(cards(page)).toHaveCount(9);
  const pager = page.getByRole("navigation", { name: "Páginas de la galería" });
  await expect(pager.getByRole("link", { name: "Página 1" })).toHaveAttribute("aria-current", "page");
  await expect(pager.getByRole("link", { name: "Página 5" })).toBeVisible();
  await audit(page, "galería");
  await expectNoHorizontalScroll(page);
  await page.locator("#galeria").screenshot({ path: `${CAPTURES}/01-galeria-${testInfo.project.name}.png` });

  await pager.getByRole("link", { name: "Siguiente →" }).click();
  await expect(page).toHaveURL(/\/plantillas\?pagina=2#galeria$/);
  await expect(page.getByRole("navigation", { name: "Páginas de la galería" }).getByRole("link", { name: "Página 2" })).toHaveAttribute("aria-current", "page");
  await expect(cards(page)).toHaveCount(9);
  // La última página trae el resto (41 = 4 × 9 + 5).
  await page.goto(`${PUBLIC_WEB_URL}/plantillas?pagina=5`);
  await expect(cards(page)).toHaveCount(5);
  // Una página fuera de rango cae en la última.
  await page.goto(`${PUBLIC_WEB_URL}/plantillas?pagina=99`);
  await expect(cards(page)).toHaveCount(5);
});

test("filtros por suscripción, rubro y búsqueda, con un estado vacío que lleva de vuelta", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/plantillas#galeria`);
  await page.getByText("Sin suscripción", { exact: true }).first().click();
  await expect(page).toHaveURL(/suscripcion=sin/);
  for (const card of await cards(page).all()) await expect(card.getByText("Sin suscripción", { exact: true })).toBeVisible();

  await page.getByText("Con suscripción", { exact: true }).first().click();
  await expect(page).toHaveURL(/suscripcion=con/);
  for (const card of await cards(page).all()) await expect(card.getByText("Con suscripción", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${CAPTURES}/02-filtro-suscripcion-${testInfo.project.name}.png`, fullPage: false });

  await page.goto(`${PUBLIC_WEB_URL}/plantillas?rubro=salud`);
  await expect(page.locator('select[name="rubro"]')).toHaveValue("salud");
  expect(await cards(page).count()).toBeGreaterThan(2);

  await page.goto(`${PUBLIC_WEB_URL}/plantillas`);
  await page.locator('input[name="q"]').fill("tatuajes");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/q=tatuajes/);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first().getByRole("link", { name: "Estudio de tatuajes" })).toBeVisible();

  await page.goto(`${PUBLIC_WEB_URL}/plantillas?q=xyzxyz`);
  await expect(page.getByText("Ninguna plantilla coincide con esos filtros.")).toBeVisible();
  await page.getByRole("link", { name: "Ver todas las plantillas" }).click();
  await expect(cards(page)).toHaveCount(9);
});

test("cada plantilla tiene su página: tres páginas en vivo con pestañas, botones al panel con la plantilla y SEO propio", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/plantillas`);
  await cards(page).first().getByRole("link").click();
  await expect(page).toHaveURL(/\/plantillas\/[a-z0-9-]+$/);

  await page.goto(`${PUBLIC_WEB_URL}/plantillas/estudio-tatuajes`);
  await expect(page.getByRole("heading", { level: 1, name: "Estudio de tatuajes", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Estudio de tatuajes: plantilla de página web para belleza y bienestar — Impulza One");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/plantillas\/estudio-tatuajes$/);
  // En el HTML del servidor (lo que lee un buscador) hay un solo título principal: el de la plantilla.
  const serverHtml = await (await page.request.get(`${PUBLIC_WEB_URL}/plantillas/estudio-tatuajes`)).text();
  expect(serverHtml.match(/<h1[\s>]/g)).toHaveLength(1);
  const jsonLd = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("");
  expect(jsonLd).toContain('"@type":"CreativeWork"');
  expect(jsonLd).toContain('"@type":"BreadcrumbList"');

  const tabs = page.getByRole("tablist", { name: "Páginas de la plantilla" }).getByRole("tab");
  await expect(tabs).toHaveText(["Inicio", "Portafolio", "Reservas"]);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(page.getByRole("tabpanel").locator("[data-gallery-sphere]")).toBeAttached();

  await expect(page.getByRole("link", { name: "Usar esta plantilla gratis" })).toHaveAttribute("href", /\/registro\?plantilla=estudio-tatuajes$/);
  await expect(page.getByRole("link", { name: "Ya tengo cuenta: usarla en mi panel" })).toHaveAttribute("href", /\/sitios\/nuevo\?plantilla=estudio-tatuajes$/);
  await expect(page.getByRole("heading", { name: "Plantillas parecidas" })).toBeVisible();
  await audit(page, "página de plantilla");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/03-plantilla-${testInfo.project.name}.png`, fullPage: true });

  const missing = await page.goto(`${PUBLIC_WEB_URL}/plantillas/no-existe`);
  expect(missing?.status()).toBe(404);
});

test("el sitemap incluye una dirección por plantilla", async ({ request }) => {
  const xml = await (await request.get(`${PUBLIC_WEB_URL}/sitemap.xml`)).text();
  expect(xml.match(/\/plantillas\/[a-z0-9-]+<\/loc>/g)?.length).toBe(41);
});

test("con cuenta: «Crear sitio» abre con la plantilla elegida en la galería", async ({ page }, testInfo) => {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto("/sitios/nuevo?plantilla=clinica-dental");
  const chosen = page.locator('li[data-template-code="clinica-dental"]');
  await expect(chosen).toBeVisible({ timeout: 30_000 });
  await expect(chosen.getByText("Elegida")).toBeVisible();
  // Se consume una sola vez.
  expect(await page.evaluate(() => window.localStorage.getItem("impulza-template-intent"))).toBeNull();
  await page.screenshot({ path: `${CAPTURES}/04-panel-crear-sitio-${testInfo.project.name}.png` });
});
