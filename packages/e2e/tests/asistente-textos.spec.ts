import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { ADMIN_SESSION_PATH, FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

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

let server: Server;
let connectionId: string | null = null;
let savedRoutes: Record<string, string[]> = {};

/** Servidor que imita `POST /v1/chat/completions` y responde según el esquema pedido. */
function startModelServer(): Promise<string> {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as { response_format?: { json_schema?: { name?: string } } };
      const name = body.response_format?.json_schema?.name;
      const output = name === "seo_proposals" ? { proposals: SEO } : name === "block_copy" ? { proposals: COPY.map((values) => ({ values })) } : { ok: true };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "simulado", choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 80 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`)));
}

async function adminApi() {
  return apiRequest.newContext({ storageState: ADMIN_SESSION_PATH, extraHTTPHeaders: CSRF });
}

test.beforeAll(async () => {
  const baseUrl = await startModelServer();
  const api = await adminApi();
  // Restos de una corrida cortada a la mitad.
  const list = (await (await api.get(`${API_BASE_URL}/admin/ai/connections`)).json()) as Array<{ id: string; name: string }>;
  for (const leftover of list.filter((c) => c.name === CONNECTION_NAME)) {
    await api.delete(`${API_BASE_URL}/admin/ai/connections/${leftover.id}`);
  }
  savedRoutes = ((await (await api.get(`${API_BASE_URL}/admin/ai/routes`)).json()) as { routes: Record<string, string[]> }).routes;
  const created = await api.post(`${API_BASE_URL}/admin/ai/connections`, {
    data: { name: CONNECTION_NAME, kind: "OPENAI_COMPATIBLE", baseUrl, model: "simulado", jsonMode: "json_schema", timeoutMs: 5_000 },
  });
  expect(created.status()).toBe(201);
  connectionId = ((await created.json()) as { id: string }).id;
  const routes = { ...savedRoutes, short_copy: [connectionId], seo: [connectionId], translate: [connectionId] };
  expect((await api.put(`${API_BASE_URL}/admin/ai/routes`, { data: { routes } })).status()).toBe(200);
  await api.dispose();
});

test.afterAll(async () => {
  const api = await adminApi();
  const kept = Object.fromEntries(Object.entries(savedRoutes).map(([task, ids]) => [task, ids.filter((id) => id !== connectionId)]));
  await api.put(`${API_BASE_URL}/admin/ai/routes`, { data: { routes: kept } });
  if (connectionId) {
    await api.delete(`${API_BASE_URL}/admin/ai/connections/${connectionId}`);
  }
  await api.dispose();
  await new Promise((resolve) => server.close(resolve));
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
