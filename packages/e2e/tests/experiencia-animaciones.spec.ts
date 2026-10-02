import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_URL } from "../playwright.config.js";

// Fase 8 (ADR-027) — animaciones y plantillas nuevas, de punta a punta y en viewport real.
// - F8.1 constructor: el bloque nuevo entra animado; con movimiento reducido NO hay animación y todo
//   sigue funcionando; un borrado que el servidor rechaza no deja el bloque invisible (defecto real
//   de la primera versión: quedaba con opacidad 0 y sin clics aunque seguía en la página).
// - F8.3 sitio comercial: las guías se revelan al hacer scroll; con movimiento reducido se ven de
//   inmediato.
// - F8.4 plantillas: las 4 nuevas aparecen en la galería pública.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const blocksPath = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}/pages/${fixture.pageId}/blocks`;

async function settleAnimations(page: Page): Promise<void> {
  // Solo las finitas: una animación infinita (p. ej. un indicador de carga) nunca «termina».
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function blockIds(api: APIRequestContext): Promise<string[]> {
  return ((await (await api.get(blocksPath)).json()) as Array<{ id: string }>).map((block) => block.id);
}

async function removeNewBlocks(api: APIRequestContext, before: Set<string>): Promise<void> {
  for (const id of await blockIds(api)) {
    if (!before.has(id)) await api.delete(`${blocksPath}/${id}`, { headers: CSRF });
  }
}

async function openEditor(page: Page): Promise<void> {
  await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
  await expect(page.getByRole("heading", { name: "Constructor visual" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Lienzo" })).toBeVisible();
}

for (const motion of ["no-preference", "reduce"] as const) {
  test(`F8.1 constructor con movimiento ${motion === "reduce" ? "reducido" : "normal"}: el bloque nuevo ${motion === "reduce" ? "aparece sin animación y funcional" : "entra animado"}`, async ({ page }, testInfo) => {
    const before = new Set(await blockIds(page.request));
    try {
      await page.emulateMedia({ reducedMotion: motion });
      await openEditor(page);

      await page.getByRole("region", { name: "Biblioteca de bloques" }).getByRole("button", { name: "Cuenta regresiva" }).click();

      // La clase se aplica ~500 ms al bloque recién creado; la animación solo existe sin `reduce`.
      const entering = page.getByRole("region", { name: "Lienzo" }).locator("li.motion-rise").first();
      await expect(entering).toBeVisible();
      await expect(entering).toHaveCSS("animation-name", motion === "reduce" ? "none" : "impulza-rise");

      // Con o sin animación, el bloque es usable: el panel de configuración abre y guarda.
      const panel = page.getByRole("region", { name: "Configuración del bloque" });
      // Panel lateral (criterio 5): entra deslizándose, salvo con movimiento reducido.
      await expect(panel.locator(".motion-slide-left")).toHaveCSS("animation-name", motion === "reduce" ? "none" : "impulza-slide-left");
      await panel.getByLabel("Título").fill("Gran apertura");
      await expect(panel.getByText("Guardado")).toBeVisible({ timeout: 15_000 });
      // Guardado (criterio 2): el aviso aparece con el efecto «pop».
      await expect(panel.getByText("Guardado")).toHaveCSS("animation-name", motion === "reduce" ? "none" : "impulza-pop");

      // Duplicar (criterio 3): el bloque nuevo entra animado justo debajo del original.
      const canvas = page.getByRole("region", { name: "Lienzo" });
      await canvas.getByRole("listitem").filter({ hasText: "Cuenta regresiva" }).getByRole("button", { name: "Duplicar bloque" }).click();
      await expect(canvas.getByRole("listitem").filter({ hasText: "Cuenta regresiva" })).toHaveCount(2);
      await expect(canvas.locator("li.motion-rise").first()).toHaveCSS("animation-name", motion === "reduce" ? "none" : "impulza-rise");
      const texts = await canvas.getByRole("listitem").allInnerTexts();
      const positions = texts.flatMap((text, index) => (text.includes("Cuenta regresiva") ? [index] : []));
      expect(positions[1]! - positions[0]!).toBe(1);
      await expectNoHorizontalScroll(page);
      await settleAnimations(page);
      await page.screenshot({ path: `.playwright/capturas/f81/constructor-${motion}-${testInfo.project.name}.png` });
    } finally {
      await removeNewBlocks(page.request, before);
    }
  });
}

test("F8.1 borrar: si el servidor rechaza la eliminación el bloque reaparece y se puede reintentar", async ({ page }) => {
  const before = new Set(await blockIds(page.request));
  try {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openEditor(page);
    await page.getByRole("region", { name: "Biblioteca de bloques" }).getByRole("button", { name: "Cuenta regresiva" }).click();
    const row = page.getByRole("region", { name: "Lienzo" }).getByRole("listitem").filter({ hasText: "Cuenta regresiva" });
    await expect(row).toHaveCount(1);

    // El servidor rechaza el borrado.
    await page.route("**/blocks/*", async (route) => {
      if (route.request().method() === "DELETE") await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Error de prueba" }) });
      else await route.continue();
    });
    await row.getByRole("button", { name: "Eliminar bloque" }).click();
    await row.getByRole("button", { name: "Sí" }).click();

    // Se desvanece (300 ms) y, al fallar, vuelve: visible, con opacidad completa y clicable.
    await expect(row).toHaveCSS("opacity", "1", { timeout: 10_000 });
    await expect(row).not.toHaveCSS("pointer-events", "none");
    await expect(row).toHaveCount(1);

    // El aviso de error es visible y la confirmación sigue abierta: reintentar es un solo clic.
    await expect(page.getByRole("alert").filter({ hasText: "No pudimos eliminar ese bloque" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Sí" })).toBeVisible();

    // Quitado el fallo, el mismo «Sí» ahora sí elimina.
    await page.unroute("**/blocks/*");
    await row.getByRole("button", { name: "Sí" }).click();
    await expect(row).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await removeNewBlocks(page.request, before);
  }
});

test.describe("sitio comercial y plantillas (build de producción)", () => {
  test("F8.3 /recursos: las guías se revelan al hacer scroll; con movimiento reducido se ven de inmediato", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "escritorio" && testInfo.project.name !== "movil", "solo proyectos de viewport");
    // Movimiento reducido: todas visibles desde el primer cuadro, sin esperar al scroll.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${PUBLIC_WEB_URL}/recursos`);
    const cards = page.locator("article");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(6);
    await expect(cards.last().locator("xpath=..")).toHaveCSS("opacity", "1");

    // Movimiento normal: la última guía empieza oculta y se revela al llegar a ella.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`${PUBLIC_WEB_URL}/recursos`);
    const last = page.locator("article").last();
    await expect(last.locator("xpath=..")).toHaveCSS("opacity", "0");
    await last.scrollIntoViewIfNeeded();
    await expect(last.locator("xpath=..")).toHaveCSS("opacity", "1", { timeout: 5_000 });
    await expect(last).toBeVisible();
    await expectNoHorizontalScroll(page);
    await settleAnimations(page);
    await page.screenshot({ path: `.playwright/capturas/f83/recursos-${testInfo.project.name}.png` });
  });

  for (const route of ["/soluciones", "/integraciones", "/plantillas"]) {
    test(`F8.3 ${route}: las secciones se revelan al hacer scroll; con movimiento reducido se ven de inmediato`, async ({ page }, testInfo) => {
      const revealed = "div.duration-700";
      // Movimiento reducido: nada queda oculto, sin esperar al scroll.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${PUBLIC_WEB_URL}${route}`);
      await expect(page.locator(revealed).first()).toBeAttached();
      const reducedOpacities = await page.locator(revealed).evaluateAll((nodes) => nodes.map((node) => Number(getComputedStyle(node).opacity)));
      expect(reducedOpacities.length).toBeGreaterThan(0);
      expect(Math.min(...reducedOpacities)).toBe(1);

      // Movimiento normal: lo que está fuera de pantalla empieza oculto y se revela al llegar a ello.
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(`${PUBLIC_WEB_URL}${route}`);
      const hidden = page.locator(`${revealed}.opacity-0`);
      await expect.poll(() => hidden.count()).toBeGreaterThan(0);
      await page.evaluate(async () => {
        for (let y = 0; y <= document.body.scrollHeight; y += 300) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      });
      await expect(hidden).toHaveCount(0, { timeout: 10_000 });
      await expectNoHorizontalScroll(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await settleAnimations(page);
      await page.screenshot({ path: `.playwright/capturas/f83/${route.slice(1)}-${testInfo.project.name}.png` });
    });
  }

  test("F8.4 /plantillas: las 4 plantillas nuevas aparecen en la galería pública", async ({ page }, testInfo) => {
    await page.goto(`${PUBLIC_WEB_URL}/plantillas`);
    for (const name of ["Academia y talleres", "Fitness y entrenamiento", "Músico y banda", "Restaurante con menú"]) {
      await expect(page.getByRole("link", { name: `Usar la plantilla ${name}` }).first()).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
    await settleAnimations(page);
    await page.screenshot({ path: `.playwright/capturas/f84/plantillas-${testInfo.project.name}.png` });
  });
});
