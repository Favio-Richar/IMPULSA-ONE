import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";
import { startSimulatedModel } from "./support/modelo-simulado.js";

// F6.3 — asistente de textos contra la API y el panel reales. El "modelo" es un servidor local
// compatible con OpenAI que responde propuestas fijas: la API lo llama de verdad por la conexión
// configurada en la administración (mismo camino que un Ollama propio). Se verifica: el asistente
// solo aparece con un modelo configurado, compara lado a lado, nada cambia hasta "Aplicar", aplicar
// guarda el borrador (no publica) y el SEO propuesto llega al formulario. Teléfono y escritorio.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const CAPTURES = ".playwright/capturas/f63";
const CONNECTION_NAME = "Modelo simulado e2e F6.3";
const pagePath = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}/pages/${fixture.pageId}`;

const COPY = [
  { label: "Agenda tu sesión de fotos", description: "Cupos disponibles esta semana" },
  { label: "Cotiza tu sesión hoy", description: "Respuesta en menos de 24 horas" },
  { label: "Ver trabajos y precios", description: "Fotografía de producto profesional" },
];
const SEO = [
  { title: "Fotografía de producto profesional | Estudio e2e", description: "Fotos de producto que venden. Agenda tu sesión y recibe tus imágenes listas para tu tienda." },
  { title: "Estudio e2e · Fotos para tu tienda online", description: "Sesiones de fotografía de producto con entrega rápida y precios claros." },
];

let model: { stop: () => Promise<void> } | null = null;

test.beforeAll(async () => {
  model = await startSimulatedModel(CONNECTION_NAME, ["short_copy", "seo", "translate"], {
    block_copy: () => ({ proposals: COPY.map((values) => ({ values })) }),
    seo_proposals: () => ({ proposals: SEO }),
  });
});

test.afterAll(async () => {
  await model?.stop();
});

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectInsideViewport(page: Page, locator: ReturnType<Page["getByRole"]>): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
}

test("propone textos para un bloque, compara lado a lado y aplica al borrador sin publicar", async ({ page }, testInfo) => {
  const created = await page.request.post(`${pagePath}/blocks`, { headers: CSRF, data: { type: "link", config: { label: "Ver", url: "https://example.com/e2e-f63" } } });
  expect(created.status()).toBe(201);
  const blockId = ((await created.json()) as { id: string }).id;
  // Publicar crea una versión de la página: si aplicar publicara, este conteo cambiaría.
  const publishState = async () => ({
    status: ((await (await page.request.get(pagePath)).json()) as { status: string }).status,
    versions: ((await (await page.request.get(`${pagePath}/versions`)).json()) as unknown[]).length,
  });
  const before = await publishState();

  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    await page.getByRole("region", { name: "Lienzo" }).getByRole("button", { name: /^Enlace/ }).last().click();
    const panel = page.getByRole("region", { name: "Configuración del bloque" });
    await panel.getByRole("button", { name: "Proponer textos" }).click();

    const dialog = page.getByRole("dialog", { name: /Proponer textos/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Nada cambia hasta que apliques.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Aplicar propuesta" })).toBeDisabled();

    await dialog.getByLabel("Indicación (opcional)").fill("más directo");
    await dialog.getByRole("button", { name: "Generar propuestas" }).click();
    await expect(dialog.getByText(COPY[0]!.label)).toBeVisible();
    await expect(dialog.getByText("Actual").first()).toBeVisible();

    // Elegir la segunda propuesta cambia la comparación.
    await dialog.getByRole("radio", { name: "2" }).check({ force: true });
    await expect(dialog.getByText(COPY[1]!.label)).toBeVisible();
    await expectInsideViewport(page, dialog);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/propuestas-${testInfo.project.name}.png` });

    // Nada se guardó todavía.
    const untouched = (await (await page.request.get(`${pagePath}/blocks`)).json()) as Array<{ id: string; config: { label: string } }>;
    expect(untouched.find((block) => block.id === blockId)?.config.label).toBe("Ver");

    await dialog.getByRole("button", { name: "Aplicar propuesta" }).click();
    await expect(dialog).toBeHidden();
    await expect(panel.getByText("Guardado")).toBeVisible();
    await expect(panel.getByLabel("Título", { exact: true })).toHaveValue(COPY[1]!.label);

    const saved = (await (await page.request.get(`${pagePath}/blocks`)).json()) as Array<{ id: string; config: { label: string; description?: string; url: string } }>;
    expect(saved.find((block) => block.id === blockId)?.config).toMatchObject({ label: COPY[1]!.label, description: COPY[1]!.description, url: "https://example.com/e2e-f63" });
    // Aplicar no publica.
    expect(await publishState()).toEqual(before);
    await page.screenshot({ path: `${CAPTURES}/aplicado-${testInfo.project.name}.png` });
  } finally {
    await page.request.delete(`${pagePath}/blocks/${blockId}`, { headers: CSRF });
  }
});

test("propone SEO con vista de buscador y lo carga en el formulario para guardarlo", async ({ page }, testInfo) => {
  const before = ((await (await page.request.get(pagePath)).json()) as { seoMeta: unknown }).seoMeta;
  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}`);
    await page.getByRole("button", { name: "Proponer con IA" }).click();
    const dialog = page.getByRole("dialog", { name: "Proponer SEO con IA" });
    await dialog.getByRole("button", { name: "Generar propuestas" }).click();
    await expect(dialog.getByText("Vista en buscadores")).toBeVisible();
    await expect(dialog.getByText(SEO[0]!.title).first()).toBeVisible();
    await expectInsideViewport(page, dialog);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/seo-${testInfo.project.name}.png` });

    await dialog.getByRole("button", { name: "Usar en el formulario" }).click();
    await expect(dialog).toBeHidden();
    const seo = page.locator("#seo");
    await expect(seo.getByLabel("Título", { exact: true })).toHaveValue(SEO[0]!.title);
    await expect(seo.getByText("Propuesta de la IA cargada en el formulario")).toBeVisible();
    await seo.getByRole("button", { name: "Guardar SEO" }).click();
    await expect(seo.getByText("SEO guardado.")).toBeVisible();
    const after = ((await (await page.request.get(pagePath)).json()) as { seoMeta: { title?: string; description?: string } }).seoMeta;
    expect(after).toMatchObject({ title: SEO[0]!.title, description: SEO[0]!.description });
  } finally {
    await page.request.patch(pagePath, { headers: CSRF, data: { seoMeta: before ?? null } });
  }
});
