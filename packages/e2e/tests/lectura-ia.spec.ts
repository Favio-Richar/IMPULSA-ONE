import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";
import { startSimulatedModel } from "./support/modelo-simulado.js";

// F6.4 — lectura comercial con IA en la pantalla de analítica, contra la API y el panel reales con un
// modelo simulado. Se verifica: la tarjeta pide elegir un sitio, el análisis muestra la explicación y
// las acciones, el aviso de muestra insuficiente sale de lo que decide el servidor (no del texto del
// modelo) y una acción que corrige un hallazgo lleva a corregirlo. Teléfono y escritorio.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f64";
const pagePath = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}/pages/${fixture.pageId}`;

const SUMMARY = "Tu sitio tiene pocas visitas todavía y la mayoría llega desde el teléfono.";
/** Hallazgo real de la página al momento de la prueba: el modelo solo puede citar uno de esos. */
let findingCode: string | null = null;
let model: { stop: () => Promise<void> } | null = null;

test.beforeAll(async () => {
  model = await startSimulatedModel("Modelo simulado e2e F6.4", ["insights"], {
    site_insights: () => ({
      summary: SUMMARY,
      actions: [
        { title: "Corrige lo pendiente de tu página", reason: "La salud de tu página marca un punto a mejorar.", kind: "fix_page", findingCode },
        { title: "Comparte tu enlace en tus redes", reason: "Con más visitas vas a poder medir qué funciona.", kind: "acquisition", findingCode: null },
        { title: "Destaca tu botón de WhatsApp", reason: "Es la forma más directa de que te escriban.", kind: "conversion", findingCode: null },
      ],
    }),
  });
});

test.afterAll(async () => {
  await model?.stop();
});

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("la lectura con IA explica los números del sitio y lleva a corregir lo que propone", async ({ page }, testInfo) => {
  const health = (await (await page.request.get(`${pagePath}/health`)).json()) as { findings: Array<{ code: string }> };
  findingCode = health.findings[0]?.code ?? null;

  await page.goto("/analitica");
  await expect(page.getByText("Elige un sitio arriba para pedir una lectura con IA")).toBeVisible();
  await page.getByLabel("Sitio").selectOption(fixture.siteId);

  const card = page.getByRole("region", { name: "Lectura con IA" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Solo lectura: no cambia nada en tu sitio.")).toBeVisible();
  await card.getByRole("button", { name: "7 días" }).click();
  await expect(card.getByRole("button", { name: "7 días" })).toHaveAttribute("aria-pressed", "true");

  const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/sites/${fixture.siteId}/ai/insights`));
  await card.getByRole("button", { name: "Analizar" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { sample: { enough: boolean }; range: { from: string; to: string } };

  await expect(card.getByText(SUMMARY)).toBeVisible();
  const actions = card.getByRole("list", { name: "Acciones recomendadas" }).getByRole("listitem");
  await expect(actions).toHaveCount(3);
  await expect(actions.nth(1)).toContainText("Atraer visitas");
  // El aviso depende de la muestra que calculó el servidor, no del texto del modelo.
  const notice = card.getByRole("note");
  if (body.sample.enough) {
    await expect(notice).toHaveCount(0);
  } else {
    await expect(notice).toContainText("Todavía hay pocas visitas para hablar de tendencias");
  }
  await expectNoHorizontalScroll(page);
  await card.screenshot({ path: `${CAPTURES}/lectura-${testInfo.project.name}.png` });

  if (findingCode) {
    const fix = actions.first().getByRole("link");
    await expect(fix).toBeVisible();
    await fix.click();
    await expect(page).toHaveURL(new RegExp(`/sitios/${fixture.siteId}`));
  } else {
    await expect(actions.first().getByRole("link")).toHaveCount(0);
  }
});
