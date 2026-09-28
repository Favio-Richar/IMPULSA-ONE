import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// F6.1 — salud de página en el constructor, contra la API y el panel reales: el indicador muestra el
// puntaje que calcula el servidor, un bloque roto aparece como hallazgo con su bloque, "Abrir el
// bloque" lo abre en el constructor, y el puntaje se recalcula solo al quitarlo. Sin desplazamiento
// horizontal y con el diálogo dentro de la pantalla en teléfono y escritorio.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const CAPTURES = ".playwright/capturas/f61";
const pagePath = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}/pages/${fixture.pageId}`;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("el constructor muestra la salud de la página y lleva a corregir cada hallazgo", async ({ page }, testInfo) => {
  const created = await page.request.post(`${pagePath}/blocks`, { headers: CSRF, data: { type: "contact_form", config: {} } });
  expect(created.status()).toBe(201);
  const formBlockId = ((await created.json()) as { id: string }).id;

  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    const indicator = page.getByRole("button", { name: /^Salud de la página: \d+ de 100/ });
    await expect(indicator).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/salud-indicador-${testInfo.project.name}.png` });

    const serverScore = ((await (await page.request.get(`${pagePath}/health`)).json()) as { score: number }).score;
    await expect(indicator).toHaveAccessibleName(new RegExp(`^Salud de la página: ${serverScore} de 100`));

    await indicator.click();
    const dialog = page.getByRole("dialog", { name: "Salud de la página" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`${serverScore} de 100`)).toBeVisible();

    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

    await page.screenshot({ path: `${CAPTURES}/salud-dialogo-${testInfo.project.name}.png` });

    const finding = dialog.getByRole("listitem").filter({ hasText: "Un formulario no está configurado" });
    await expect(finding).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Importante" })).toContainText("Un formulario no está configurado");
    await finding.getByRole("button", { name: "Abrir el bloque" }).click();

    // El diálogo se cierra y el bloque queda abierto en el panel de configuración.
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("region", { name: "Configuración del bloque" }).getByText(/formulario/i).first()).toBeVisible();

    // Quitado el bloque roto (por la API, fuera del panel), la página recargada ya no lo cuenta.
    const removed = await page.request.delete(`${pagePath}/blocks/${formBlockId}`, { headers: CSRF });
    expect(removed.status()).toBe(204);
    await page.reload();
    const after = ((await (await page.request.get(`${pagePath}/health`)).json()) as { score: number; findings: Array<{ code: string }> });
    expect(after.findings.map((f) => f.code)).not.toContain("form_not_configured");
    await expect(page.getByRole("button", { name: new RegExp(`^Salud de la página: ${after.score} de 100`) })).toBeVisible();
  } finally {
    await page.request.delete(`${pagePath}/blocks/${formBlockId}`, { headers: CSRF });
  }
});
