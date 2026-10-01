import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F7.8c (ADR-023) — carrito: un visitante agrega una polera (con talla) y una taza, ve la barra con
// el total, cambia cantidades en el panel y pide todo junto; un producto digital no se agrega (se
// compra solo); el carrito sobrevive a recargar la página; el negocio ve el pedido con sus líneas.
// Teléfono y escritorio, sin desplazamiento horizontal.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const CAPTURES = ".playwright/capturas/f78c";

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let blockId: string;
const products: Record<"polera" | "taza" | "guia", { id: string; name: string }> = {
  polera: { id: "", name: "" },
  taza: { id: "", name: "" },
  guia: { id: "", name: "" },
};
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

async function catalog(): Promise<Array<{ id: string; stock: number | null; variants: Array<{ name: string; stock: number | null }> }>> {
  return (await (await api.get(`${site}/catalog/products`)).json()) as Array<{ id: string; stock: number | null; variants: Array<{ name: string; stock: number | null }> }>;
}

test.beforeAll(async () => {
  const testInfo = test.info();
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  const suffix = `${testInfo.project.name} ${Date.now().toString(36)}`;
  customer = `Cliente carrito ${suffix}`;
  const create = async (key: keyof typeof products, data: Record<string, unknown>) => {
    const name = `${String(data.name)} ${suffix}`;
    const res = await api.post(`${site}/catalog/products`, { headers: CSRF, data: { priceCurrency: "CLP", ...data, name } });
    expect(res.status()).toBe(201);
    products[key] = { id: ((await res.json()) as { id: string }).id, name };
  };
  await create("polera", { name: "Polera carrito", kind: "PHYSICAL", priceAmount: 10000 });
  await create("taza", { name: "Taza carrito", kind: "PHYSICAL", priceAmount: 5000, stock: 3 });
  await create("guia", { name: "Guía carrito", kind: "DIGITAL", priceAmount: 3000 });
  expect((await api.post(`${site}/catalog/products/${products.polera.id}/variants`, { headers: CSRF, data: { name: "M", stock: 5 } })).status()).toBe(201);
  expect((await api.post(`${site}/catalog/products/${products.polera.id}/variants`, { headers: CSRF, data: { name: "L" } })).status()).toBe(201);
  const block = await api.post(blocksPath, {
    headers: CSRF,
    data: { type: "catalog", config: { label: `Tienda carrito ${testInfo.project.name}`, productIds: [products.polera.id, products.taza.id, products.guia.id] } },
  });
  expect(block.status()).toBe(201);
  blockId = ((await block.json()) as { id: string }).id;
  expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
  await revalidate();
});

test.afterAll(async () => {
  await api.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
  for (const product of Object.values(products)) {
    if (product.id) await api.delete(`${site}/catalog/products/${product.id}`, { headers: CSRF });
  }
  await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
  await revalidate();
  await api.dispose();
});

test("un visitante agrega dos productos al carrito, ajusta cantidades y pide todo junto", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  // Polera talla M × 2.
  await page.locator("summary", { hasText: products.polera.name }).click();
  const polera = page.getByRole("form", { name: products.polera.name });
  await polera.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(polera.getByRole("alert").filter({ hasText: "Elige una opción" })).toBeVisible();
  await polera.locator('[data-variant-option="M"]').click();
  await polera.getByRole("button", { name: "Una unidad más" }).click();
  await polera.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(polera.getByRole("status").filter({ hasText: "quedó en tu carrito" })).toContainText(`${products.polera.name} (M)`);
  const bar = page.locator("[data-cart-bar]");
  await expect(bar).toContainText("Ver carrito · 2 unidades · $20.000");
  // Visible de verdad mientras se recorre la página (sticky al pie), no solo presente en el DOM.
  await expect(bar).toBeInViewport();

  // Taza × 1.
  await page.locator("summary", { hasText: products.taza.name }).click();
  await page.getByRole("form", { name: products.taza.name }).getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(bar).toContainText("3 unidades · $25.000");
  await page.locator("summary", { hasText: products.polera.name }).scrollIntoViewIfNeeded();
  await expect(bar).toBeInViewport();

  // Un producto digital se compra solo: no ofrece el carrito.
  await page.locator("summary", { hasText: products.guia.name }).click();
  await expect(page.getByRole("form", { name: products.guia.name }).getByRole("button", { name: "Agregar al carrito" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/barra-${testInfo.project.name}.png`, fullPage: false });

  // Panel del carrito: una taza más.
  await bar.getByRole("button").click();
  const dialog = page.getByRole("dialog", { name: "Tu carrito" });
  await expect(dialog.locator("[data-cart-line]")).toHaveCount(2);
  await dialog.getByRole("button", { name: `Una unidad más de ${products.taza.name}` }).click();
  await expect(dialog.getByRole("button", { name: /Hacer pedido · \$30\.000/ })).toBeVisible();
  await dialog.getByLabel("Nombre *").fill(customer);
  await dialog.getByLabel("Correo *").fill(`carrito-${Date.now().toString(36)}@e2e.test`);
  await dialog.getByLabel("Dirección de entrega *").fill("Av. Siempre Viva 742, Santiago");
  await dialog.getByText("Acepto que este negocio").click();
  await page.screenshot({ path: `${CAPTURES}/panel-${testInfo.project.name}.png`, fullPage: false });
  await dialog.getByRole("button", { name: /Hacer pedido/ }).click();

  const done = page.getByRole("dialog", { name: "¡Pedido recibido!" });
  await expect(done).toContainText(`${products.polera.name} (M) y 1 producto más`);
  await expect(done).toContainText("Total: $30.000");
  await page.screenshot({ path: `${CAPTURES}/confirmado-${testInfo.project.name}.png`, fullPage: false });
  await done.getByRole("button", { name: "Cerrar el carrito" }).click();
  // El carrito quedó vacío: sin barra.
  await expect(bar).toHaveCount(0);

  const after = await catalog();
  expect(after.find((p) => p.id === products.polera.id)!.variants.find((v) => v.name === "M")!.stock).toBe(3);
  expect(after.find((p) => p.id === products.taza.id)!.stock).toBe(1);
});

test("el carrito sobrevive a recargar la página y se puede vaciar", async ({ page }) => {
  await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
  await page.locator("summary", { hasText: products.taza.name }).click();
  await page.getByRole("form", { name: products.taza.name }).getByRole("button", { name: "Agregar al carrito" }).click();
  await page.reload();
  const bar = page.locator("[data-cart-bar]");
  await expect(bar).toContainText("1 unidad · $5.000");
  await bar.getByRole("button").click();
  const dialog = page.getByRole("dialog", { name: "Tu carrito" });
  await dialog.getByRole("button", { name: `Quitar ${products.taza.name} del carrito` }).click();
  await expect(dialog).toContainText("Tu carrito está vacío.");
  await dialog.getByRole("button", { name: "Cerrar el carrito" }).click();
  await expect(bar).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("el negocio ve el pedido del carrito con cada línea", async ({ page }, testInfo) => {
  await page.goto("/pedidos");
  const card = page.locator("[data-order]", { hasText: customer });
  const lines = card.getByRole("list", { name: "Productos del pedido" });
  await expect(lines.getByRole("listitem")).toHaveCount(2);
  await expect(lines).toContainText(`2 × ${products.polera.name} (M)`);
  await expect(lines).toContainText(`2 × ${products.taza.name}`);
  await expect(card).toContainText("$30.000");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/pedidos-${testInfo.project.name}.png`, fullPage: true });
});
