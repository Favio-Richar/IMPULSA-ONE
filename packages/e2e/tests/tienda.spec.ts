import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F5.5 — tienda: un visitante pide un producto desde un botón de la pila (cantidad, datos,
// confirmación con el pago del negocio) y el negocio lo ve en Pedidos y lo marca pagado y
// entregado; el catálogo del panel lista y crea productos. Sin desplazamiento horizontal.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const CAPTURES = ".playwright/capturas/f55";

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let productId: string;
let blockId: string;
let productName: string;
let customer: string;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function revalidate(): Promise<void> {
  const revalidated = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
    headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
    data: { siteSlug: fixture.siteSlug },
  });
  expect(revalidated.status()).toBe(200);
}

test.beforeAll(async ({}, testInfo) => {
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  const suffix = `${testInfo.project.name} ${Date.now().toString(36)}`;
  productName = `Vela e2e ${suffix}`;
  customer = `Cliente tienda ${suffix}`;
  const product = await api.post(`${site}/catalog/products`, {
    headers: CSRF,
    data: { name: productName, kind: "PHYSICAL", priceAmount: 12990, priceCurrency: "CLP", stock: 5, paymentUrl: "https://example.com/pago-tienda" },
  });
  expect(product.status()).toBe(201);
  productId = ((await product.json()) as { id: string }).id;
  // Un bloque por proyecto, limitado a su producto: las dos corridas no se ven entre sí.
  const block = await api.post(blocksPath, { headers: CSRF, data: { type: "catalog", config: { label: `Tienda ${testInfo.project.name}`, productIds: [productId] } } });
  expect(block.status()).toBe(201);
  blockId = ((await block.json()) as { id: string }).id;
  expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
  await revalidate();
});

test.afterAll(async () => {
  await api.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
  await api.delete(`${site}/catalog/products/${productId}`, { headers: CSRF });
  await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
  await revalidate();
  await api.dispose();
});

test("un visitante pide un producto desde un botón de la pila y ve la confirmación con el pago del negocio", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
  const summary = page.locator("summary", { hasText: productName });
  await expect(summary).toBeVisible();
  // Botón de la pila: a lo ancho y con el alto del resto, con precio y acción.
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(56);
  await expect(summary).toContainText("$12.990 · Pedir");
  await summary.click();

  const form = page.getByRole("form", { name: productName });
  await form.getByRole("button", { name: "Una unidad más" }).click();
  await expect(form.getByRole("button", { name: /Hacer pedido · \$25\.980/ })).toBeVisible();
  await form.getByLabel("Nombre *").fill(customer);
  await form.getByLabel("Correo *").fill(`tienda-${Date.now().toString(36)}@e2e.test`);
  await page.screenshot({ path: `${CAPTURES}/pedido-formulario-${testInfo.project.name}.png`, fullPage: true });
  // Producto físico: sin dirección no se envía.
  await form.getByText("Acepto que este negocio").click();
  await form.getByRole("button", { name: /Hacer pedido/ }).click();
  await expect(form.getByRole("alert").filter({ hasText: "dirección" })).toBeVisible();
  await form.getByLabel("Dirección de entrega *").fill("Av. Siempre Viva 742, Santiago");
  await form.getByRole("button", { name: /Hacer pedido/ }).click();

  await expect(page.getByRole("heading", { name: "¡Pedido recibido!" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pagar ahora" })).toHaveAttribute("href", "https://example.com/pago-tienda");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/pedido-confirmado-${testInfo.project.name}.png`, fullPage: true });

  const stock = ((await (await api.get(`${site}/catalog/products`)).json()) as Array<{ id: string; stock: number | null }>).find((p) => p.id === productId)?.stock;
  expect(stock).toBe(3);
});

test("el negocio ve el pedido en Pedidos y lo marca pagado y entregado", async ({ page }, testInfo) => {
  await page.goto("/pedidos");
  await expect(page.getByRole("heading", { name: "Pedidos", level: 1 })).toBeVisible();
  const card = page.locator("[data-order]", { hasText: customer });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Nuevo");
  await expect(card).toContainText("Av. Siempre Viva 742");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/pedidos-${testInfo.project.name}.png`, fullPage: true });

  await card.getByRole("button", { name: new RegExp(`^Marcar pagado: pedido de ${customer}`) }).click();
  await expect(card).toContainText("Pagado");
  await card.getByRole("button", { name: new RegExp(`^Marcar entregado: pedido de ${customer}`) }).click();
  await expect(card).toContainText("Entregado");
  await expect(card.getByRole("button")).toHaveCount(0);

  await page.getByRole("tab", { name: /Entregados/ }).click();
  await expect(page.locator("[data-order]", { hasText: customer })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await expectNoHorizontalScroll(page);
});

test("el catálogo del sitio lista los productos y agrega uno nuevo", async ({ page }, testInfo) => {
  await page.goto(`/sitios/${fixture.siteId}/catalogo`);
  await expect(page.getByRole("heading", { name: "Catálogo", level: 1 })).toBeVisible();
  const row = page.locator("[data-product]", { hasText: productName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("3 en stock");

  const newName = `Guía e2e ${testInfo.project.name} ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Agregar producto" }).click();
  const form = page.getByRole("form", { name: "Nuevo producto" });
  await form.getByLabel("Nombre").fill(newName);
  await form.getByLabel("Tipo").selectOption("DIGITAL");
  await form.getByLabel("Precio").fill("4.990");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/catalogo-nuevo-${testInfo.project.name}.png`, fullPage: true });
  await form.getByRole("button", { name: "Agregar producto" }).click();
  await expect(form).toHaveCount(0);

  const created = page.locator("[data-product]", { hasText: newName });
  await expect(created).toContainText("$4.990");
  await expect(created).toContainText("Producto digital");
  await created.getByRole("button", { name: `Borrar ${newName}` }).click();
  await created.getByRole("button", { name: "Sí" }).click();
  await expect(created).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("el menú lleva al catálogo sin pasar por el sitio", async ({ page }, testInfo) => {
  await page.goto("/");
  // En el teléfono el menú está plegado detrás de su botón.
  if (testInfo.project.name === "movil") {
    await page.getByRole("button", { name: "Abrir menú" }).click();
  }
  await page.getByRole("link", { name: "Catálogo", exact: true }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/catalogo$/);
  await expect(page.getByRole("heading", { name: "Catálogo", level: 1 })).toBeVisible();
  await expect(page.locator("[data-product]", { hasText: productName })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
