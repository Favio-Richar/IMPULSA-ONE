import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F10 — álbum profesional: filtros por categoría, «ver más», y visor a pantalla completa con teclado, contador, foco
// atrapado y devuelto. En teléfono y escritorio, sin desbordes ni violaciones de CSP.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("página publicada", () => {
  let api: APIRequestContext;
  const ids: string[] = [];

  async function revalidate(): Promise<void> {
    const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, { headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET }, data: { siteSlug: fixture.siteSlug } });
    expect(response.status()).toBe(200);
  }

  test.beforeAll(async () => {
    api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
    const photos = Array.from({ length: 14 }, (_, index) => ({
      image: { url: `https://cdn.ejemplo.cl/foto-${index + 1}.jpg`, alt: `Fotografía número ${index + 1}` },
      title: `Obra ${index + 1}`,
      category: index % 2 === 0 ? "Retrato" : "Moda",
    }));
    const response = await api.post(blocksPath, { headers: CSRF, data: { type: "album", config: { title: "Álbum de prueba", photos } } });
    expect(response.status(), await response.text()).toBe(201);
    ids.push(((await response.json()) as { id: string }).id);
    expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
    await revalidate();
  });

  test.afterAll(async () => {
    for (const id of ids) await api.delete(`${blocksPath}/${id}`, { headers: CSRF });
    await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
    await revalidate();
    await api.dispose();
  });

  test("filtra por categoría, carga más y abre el visor con teclado, contador y foco devuelto", async ({ browser, viewport }, testInfo) => {
    const context = await browser.newContext({ viewport: viewport!, locale: "es-CL" });
    await context.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (event) => (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    await context.route(/cdn\.ejemplo\.cl/, (route) => route.fulfill({ status: 200, contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }));
    const page = await context.newPage();
    await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);

    const section = page.getByRole("region", { name: "Álbum de prueba" });
    await expect(section).toBeVisible();
    // Carga de a 12: las 2 restantes esperan a «Ver más».
    await expect(section.getByRole("button", { name: /^Ver foto:/ })).toHaveCount(12);
    await section.getByRole("button", { name: "Ver más fotos (2)" }).click();
    await expect(section.getByRole("button", { name: /^Ver foto:/ })).toHaveCount(14);

    // Filtros: «Moda» deja 7 fotos y marca el botón activo.
    await section.getByRole("button", { name: "Moda", exact: true }).click();
    await expect(section.getByRole("button", { name: "Moda", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(section.getByRole("button", { name: /^Ver foto:/ })).toHaveCount(7);
    await section.getByRole("button", { name: "Todas", exact: true }).click();

    // Visor: abre en la foto tocada, navega con flechas, cierra con Esc y devuelve el foco a esa foto.
    const first = section.getByRole("button", { name: "Ver foto: Obra 1", exact: true });
    await first.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("1 / 14");
    expect((await dialog.getByRole("button", { name: "Foto siguiente" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("ArrowRight");
    await expect(dialog).toContainText("2 / 14");
    await expect(dialog).toContainText("Obra 2");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(dialog).toContainText("14 / 14");
    await page.screenshot({ path: `.playwright/capturas/album/visor-${testInfo.project.name}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(first).toBeFocused();

    await expectNoHorizontalScroll(page);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    await context.close();
  });
});
