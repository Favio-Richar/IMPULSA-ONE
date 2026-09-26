import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// PP5 — acción principal y entrada de los bloques, contra la API y el panel reales: marcar un
// enlace como principal desde el constructor y ver en la vista previa de teléfono la barra fija
// (pegada abajo al recorrer, escondida mientras el bloque original se ve, sin tapar el final), que
// en escritorio no exista, y que con "reducir movimiento" no haya animación.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const blocksPath = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}/pages/${fixture.pageId}/blocks`;
const LONG_TEXT = `<p>${"Texto de relleno para que la página sea más alta que la pantalla. ".repeat(12)}</p>`;

async function addFillerBlocks(page: Page, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const response = await page.request.post(blocksPath, { headers: CSRF, data: { type: "text", config: { html: LONG_TEXT } } });
    expect(response.status()).toBe(201);
    ids.push(((await response.json()) as { id: string }).id);
  }
  return ids;
}

/** El contenedor con scroll de la vista previa (el marco del dispositivo no scrollea: recorta). */
function previewScroller(page: Page): Locator {
  return page.locator("div.overflow-auto").filter({ has: page.locator("[data-site-root]") }).last();
}

test("la acción principal se marca en el constructor y en el teléfono queda fija abajo sin tapar el final", async ({ page }) => {
  // Punto de partida conocido, aunque una corrida anterior se haya cortado a mitad de camino.
  await page.request.put(`${blocksPath}/primary`, { headers: CSRF, data: { blockId: null } });
  const fillers = await addFillerBlocks(page, 5);
  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    const canvas = page.getByRole("region", { name: "Lienzo" });
    await canvas.getByRole("button", { name: /^Enlace/ }).click();

    const toggle = page.getByRole("checkbox", { name: "Acción principal" });
    await expect(toggle).not.toBeChecked();
    // Optimista: se marca al instante; y se espera la confirmación real antes de seguir.
    const saved = page.waitForResponse((response) => response.url().endsWith("/blocks/primary") && response.request().method() === "PUT");
    await toggle.check();
    await expect(toggle).toBeChecked();
    expect((await saved).status()).toBe(200);
    await expect(canvas.getByText("Principal", { exact: true })).toBeVisible();

    // Vista previa en modo teléfono.
    await page.getByRole("button", { name: "Móvil" }).click();
    const site = page.locator("[data-site-root]");
    const inFlow = site.locator("[data-primary-action]");
    const bar = site.locator("[data-primary-action-bar]");
    await expect(inFlow).toBeVisible();
    await expect(bar.getByRole("link", { name: "Ver nuestros servicios" })).toHaveAttribute("href", "https://ejemplo.com");

    const scroller = previewScroller(page);
    await scroller.scrollIntoViewIfNeeded();

    // Con el bloque original a la vista, la barra se esconde (y no se puede enfocar).
    await inFlow.scrollIntoViewIfNeeded();
    await expect(bar).toHaveAttribute("data-state", "hidden");
    await expect(bar).toHaveAttribute("inert", "");

    // A mitad del recorrido, el original quedó arriba: la barra aparece pegada al borde inferior.
    const middle = site.locator('[data-block-type="text"]').nth(3);
    await middle.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect(bar).toHaveAttribute("data-state", "visible");
    const view = (await scroller.boundingBox())!;
    const stuck = (await bar.boundingBox())!;
    // Pegada a la parte inferior de lo visible (el marco de la vista previa tiene 16 px de relleno;
    // en el sitio real el contenedor es la ventana y queda al ras).
    const visibleBottom = Math.min(view.y + view.height, page.viewportSize()!.height);
    expect(stuck.y + stuck.height).toBeLessThanOrEqual(visibleBottom + 1);
    expect(stuck.y + stuck.height).toBeGreaterThanOrEqual(visibleBottom - 24);

    // Al final, se asienta debajo del último bloque: no lo tapa.
    await scroller.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    const last = site.locator('[data-block-type="text"]').last();
    await expect.poll(async () => (await bar.boundingBox())!.y).toBeGreaterThanOrEqual((await last.boundingBox())!.y + (await last.boundingBox())!.height - 1);

    // Decide el ancho del contenedor, no el de la ventana: en un marco de 640 px o más no existe; en
    // uno más angosto (el "Escritorio" de un panel abierto en el teléfono) sigue siendo un teléfono.
    const desktop = page.getByRole("button", { name: "Escritorio" });
    await desktop.click();
    await expect(desktop).toHaveAttribute("aria-pressed", "true");
    // El marco anima su ancho: se reintenta hasta que la invariante se cumple ya asentado.
    await expect
      .poll(async () => {
        const width = (await site.boundingBox())!.width;
        const hidden = (await bar.evaluate((element) => getComputedStyle(element).display)) === "none";
        return hidden === width >= 640;
      })
      .toBe(true);
  } finally {
    await page.request.put(`${blocksPath}/primary`, { headers: CSRF, data: { blockId: null } });
    for (const id of fillers) {
      await page.request.delete(`${blocksPath}/${id}`, { headers: CSRF });
    }
  }
});

test("la entrada de los bloques se anima, salvo con «reducir movimiento»", async ({ page }) => {
  await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
  const block = page.locator("[data-site-root] .site-block-enter").first();
  await expect(block).toBeVisible();
  expect(await block.evaluate((element) => getComputedStyle(element).animationName)).toBe("site-block-enter");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(block).toBeVisible();
  expect(await block.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});
