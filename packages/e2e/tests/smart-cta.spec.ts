import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F6.6 — Smart CTA de punta a punta: las reglas se editan en la pantalla de la página y el sitio
// público real (en producción) cambia el botón principal según la visita — acá, por la campaña de
// la URL —, en el HTML que entrega el servidor. Sin campaña, queda el principal de siempre.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const CAPTURES = ".playwright/capturas/f66";
const pagePath = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}/pages/${fixture.pageId}`;
const DEFAULT_LABEL = "Ver servicios e2e F6.6";
const CAMPAIGN_LABEL = "Escríbenos por la promo";

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function revalidatePublicSite(page: Page): Promise<void> {
  const response = await page.request.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
    headers: { "content-type": "application/json", "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
    data: { siteSlug: fixture.siteSlug },
  });
  expect(response.ok()).toBe(true);
}

/** Texto del botón principal que entrega el servidor para esa URL (con JavaScript apagado). */
async function primaryActionText(browser: Browser, query: string): Promise<string> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const visitor = await context.newPage();
  await visitor.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}${query}`);
  const text = await visitor.locator("[data-primary-action]").first().innerText();
  await context.close();
  return text;
}

test("las reglas se editan en la página y el sitio real cambia el botón principal según la campaña", async ({ page, browser }, testInfo) => {
  const link = await page.request.post(`${pagePath}/blocks`, { headers: CSRF, data: { type: "link", config: { label: DEFAULT_LABEL, url: "https://example.com/servicios-f66" } } });
  const whatsapp = await page.request.post(`${pagePath}/blocks`, { headers: CSRF, data: { type: "whatsapp", config: { phone: "+56912345678", label: CAMPAIGN_LABEL } } });
  expect(link.status()).toBe(201);
  expect(whatsapp.status()).toBe(201);
  const linkId = ((await link.json()) as { id: string }).id;
  const whatsappId = ((await whatsapp.json()) as { id: string }).id;
  expect((await page.request.put(`${pagePath}/blocks/primary`, { headers: CSRF, data: { blockId: linkId } })).status()).toBe(200);
  expect((await page.request.post(`${pagePath}/publish`, { headers: CSRF })).status()).toBe(201);

  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}`);
    const card = page.locator("#smart-cta");
    await expect(card.getByText("Sin reglas: siempre se muestra tu botón principal.")).toBeVisible();

    await card.getByRole("button", { name: "Agregar regla" }).click();
    const rule = card.getByRole("listitem").first();
    await rule.getByLabel("Cuando").selectOption("utm_campaign");
    // Sin elegir botón, el formulario lo dice antes de enviar.
    await card.getByRole("button", { name: "Guardar reglas" }).click();
    await expect(card.getByText("Elige qué botón pasa a ser el principal en cada regla.")).toBeVisible();
    await rule.getByLabel("Campaña (utm_campaign)").fill("Promo F66");
    await rule.getByLabel("Botón principal").selectOption(whatsappId);
    await expect(card.getByText("Elige qué botón pasa a ser el principal en cada regla.")).toBeHidden();
    await expectNoHorizontalScroll(page);
    await card.screenshot({ path: `${CAPTURES}/reglas-${testInfo.project.name}.png` });
    await card.getByRole("button", { name: "Guardar reglas" }).click();
    await expect(card.getByText("Reglas guardadas. Ya rigen en tu página.")).toBeVisible();

    // Recargar muestra lo guardado (con el valor normalizado).
    await page.reload();
    await expect(page.locator("#smart-cta").getByLabel("Campaña (utm_campaign)")).toHaveValue("promo-f66");

    await revalidatePublicSite(page);
    expect(await primaryActionText(browser, "")).toContain(DEFAULT_LABEL);
    expect(await primaryActionText(browser, "?utm_campaign=Promo%20F66")).toContain(CAMPAIGN_LABEL);
    expect(await primaryActionText(browser, "?utm_campaign=otra")).toContain(DEFAULT_LABEL);
  } finally {
    await page.request.put(`${pagePath}/smart-cta`, { headers: CSRF, data: { rules: [] } });
    await page.request.put(`${pagePath}/blocks/primary`, { headers: CSRF, data: { blockId: null } });
    await page.request.delete(`${pagePath}/blocks/${linkId}`, { headers: CSRF });
    await page.request.delete(`${pagePath}/blocks/${whatsappId}`, { headers: CSRF });
    await page.request.post(`${pagePath}/publish`, { headers: CSRF });
    await revalidatePublicSite(page);
  }
});
