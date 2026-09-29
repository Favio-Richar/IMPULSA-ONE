import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F6.5 — pruebas A/B de punta a punta: se empieza desde el constructor, el sitio público real (en
// producción) muestra A o B según el grupo del visitante —siempre la misma para la misma persona,
// sin parpadeo porque la elige el servidor—, la pantalla de pruebas muestra resultados y veredicto,
// y "Aplicar B" deja el cambio en el borrador sin publicar. Sin prueba en curso no se crea cookie.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const CAPTURES = ".playwright/capturas/f65";
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const pagePath = `${site}/pages/${fixture.pageId}`;
const LABEL_A = "Ver catálogo e2e F6.5";
const LABEL_B = "Reserva tu hora hoy";

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** El servidor de producción cachea el sitio: se invalida por la vía oficial, como lo hace la API. */
async function revalidatePublicSite(page: Page): Promise<void> {
  const response = await page.request.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
    headers: { "content-type": "application/json", "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
    data: { siteSlug: fixture.siteSlug },
  });
  expect(response.ok()).toBe(true);
}

/** Lo que ve un visitante nuevo (o de un grupo dado) en el sitio público, y la cookie que le queda. */
async function visit(browser: Browser, bucket: number | null): Promise<{ labels: string[]; cookie: string | null }> {
  const context = await browser.newContext();
  if (bucket !== null) {
    await context.addCookies([{ name: "imp_ab", value: String(bucket), url: PUBLIC_WEB_URL }]);
  }
  const visitor = await context.newPage();
  await visitor.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
  const labels = await visitor.getByRole("link").allInnerTexts();
  await visitor.waitForTimeout(300);
  const cookie = (await context.cookies(PUBLIC_WEB_URL)).find((entry) => entry.name === "imp_ab")?.value ?? null;
  await context.close();
  return { labels, cookie };
}

test("una prueba A/B se empieza en el constructor, reparte visitantes en el sitio real y se aplica al borrador", async ({ page, browser }, testInfo) => {
  const created = await page.request.post(`${pagePath}/blocks`, { headers: CSRF, data: { type: "link", config: { label: LABEL_A, url: "https://example.com/catalogo-f65" } } });
  expect(created.status()).toBe(201);
  const blockId = ((await created.json()) as { id: string }).id;
  expect((await page.request.post(`${pagePath}/publish`, { headers: CSRF })).status()).toBe(201);

  try {
    // 1. Empezar desde el constructor.
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    await page.getByRole("region", { name: "Lienzo" }).getByRole("button", { name: /^Enlace/ }).last().click();
    const panel = page.getByRole("region", { name: "Configuración del bloque" });
    await panel.getByRole("button", { name: "Probar una variante" }).click();
    const dialog = page.getByRole("dialog", { name: /Probar una variante/ });
    await expect(dialog.getByText(LABEL_A)).toBeVisible();
    await dialog.getByRole("button", { name: "Empezar la prueba" }).click();
    await expect(dialog.getByText("Cambia al menos un campo")).toBeVisible();
    await dialog.getByLabel("Texto del botón · B").fill(LABEL_B);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/nueva-${testInfo.project.name}.png` });
    await dialog.getByRole("button", { name: "Empezar la prueba" }).click();
    await expect(dialog).toBeHidden();
    await expect(panel.getByText(/En curso:/)).toBeVisible();

    // 2. Sitio público en producción: los grupos 0 y 1 caen siempre en variantes distintas.
    await revalidatePublicSite(page);
    const first = await visit(browser, 0);
    const second = await visit(browser, 1);
    const seen = [first, second].map(({ labels }) => (labels.includes(LABEL_B) ? "b" : labels.includes(LABEL_A) ? "a" : "ninguna"));
    expect(seen.sort()).toEqual(["a", "b"]);
    expect((await visit(browser, 0)).labels).toEqual(first.labels);
    // Un visitante nuevo recibe un grupo válido, guardado en una cookie propia.
    expect((await visit(browser, null)).cookie).toMatch(/^\d{1,2}$/);

    // 3. Resultados y aplicar B.
    await page.goto(`/sitios/${fixture.siteId}/pruebas`);
    const card = page.getByRole("article").filter({ hasText: "Prueba de enlace" }).first();
    await expect(card.getByText("Sin resultado todavía")).toBeVisible();
    await expect(card.getByRole("region", { name: "Variante B" })).toContainText(LABEL_B);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/resultados-${testInfo.project.name}.png`, fullPage: true });

    const versionsBefore = ((await (await page.request.get(`${pagePath}/versions`)).json()) as unknown[]).length;
    await card.getByRole("button", { name: "Aplicar B al borrador" }).click();
    await expect(card.getByText("La variante B quedó en el borrador del bloque.")).toBeVisible();
    const blocks = (await (await page.request.get(`${pagePath}/blocks`)).json()) as Array<{ id: string; config: { label: string } }>;
    expect(blocks.find((block) => block.id === blockId)?.config.label).toBe(LABEL_B);
    expect(((await (await page.request.get(`${pagePath}/versions`)).json()) as unknown[]).length).toBe(versionsBefore);

    // 4. Sin prueba en curso, el sitio público no crea ninguna cookie.
    await revalidatePublicSite(page);
    expect((await visit(browser, null)).cookie).toBeNull();
  } finally {
    await page.request.delete(`${pagePath}/blocks/${blockId}`, { headers: CSRF });
    await page.request.post(`${pagePath}/publish`, { headers: CSRF });
    await revalidatePublicSite(page);
  }
});
