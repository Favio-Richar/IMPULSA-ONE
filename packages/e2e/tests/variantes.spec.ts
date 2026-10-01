import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F7.8a (ADR-023) — variantes: el negocio agrega tallas a un producto (con su precio y stock), las
// ordena y ve el error de nombre repetido; un visitante elige una talla en la página pública (la
// agotada no se puede elegir) y pide; el pedido nombra la variante y descuenta su stock.
// Teléfono y escritorio, sin desplazamiento horizontal.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const CAPTURES = ".playwright/capturas/f78a";

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

async function variantStock(name: string): Promise<number | null | undefined> {
  const products = (await (await api.get(`${site}/catalog/products`)).json()) as Array<{ id: string; variants: Array<{ name: string; stock: number | null }> }>;
  return products.find((p) => p.id === productId)?.variants.find((v) => v.name === name)?.stock;
}

test.beforeAll(async () => {
  const testInfo = test.info();
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  const suffix = `${testInfo.project.name} ${Date.now().toString(36)}`;
  productName = `Polera e2e ${suffix}`;
  customer = `Cliente variante ${suffix}`;
  const product = await api.post(`${site}/catalog/products`, { headers: CSRF, data: { name: productName, kind: "PHYSICAL", priceAmount: 9990, priceCurrency: "CLP" } });
  expect(product.status()).toBe(201);
  productId = ((await product.json()) as { id: string }).id;
  const block = await api.post(blocksPath, { headers: CSRF, data: { type: "catalog", config: { label: `Tienda variantes ${testInfo.project.name}`, productIds: [productId] } } });
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

test("el negocio agrega variantes con precio y stock, las ordena y ve el nombre repetido", async ({ page }, testInfo) => {
  await page.goto(`/sitios/${fixture.siteId}/catalogo`);
  const row = page.locator("[data-product]", { hasText: productName });
  await expect(row).toBeVisible();
  const toggle = row.getByRole("button", { name: /Variantes \(talla, color, formato/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(row.getByText("Agrega opciones si vendes este producto")).toBeVisible();

  const add = async (name: string, price: string, stock: string) => {
    await row.getByRole("button", { name: "Agregar variante" }).click();
    const form = row.getByRole("form", { name: `Nueva variante de ${productName}` });
    await form.getByLabel("Nombre de la variante").fill(name);
    await form.getByLabel(/^Precio/).fill(price);
    await form.getByLabel("Stock").fill(stock);
    await form.getByRole("button", { name: "Agregar variante" }).click();
    await expect(form).toHaveCount(0);
  };
  await add("M", "", "1");
  await add("L", "12.990", "5");
  await add("XL", "", "0");

  const list = row.getByRole("list", { name: `Variantes de ${productName}` });
  await expect(list.locator("[data-variant]")).toHaveCount(3);
  await expect(list.locator('[data-variant="M"]')).toContainText("$9.990 (precio del producto)");
  await expect(list.locator('[data-variant="L"]')).toContainText("$12.990");
  await expect(list.locator('[data-variant="L"]')).toContainText("5 en stock");
  await expect(list.locator('[data-variant="XL"]')).toContainText("Agotada");

  // Ordenar: L sube al primer lugar.
  await list.getByRole("button", { name: "Subir L" }).click();
  await expect(list.locator("[data-variant]").first()).toHaveAttribute("data-variant", "L");
  // Ya primera: no puede subir más.
  await expect(list.getByRole("button", { name: "Subir L" })).toBeDisabled();

  // Nombre repetido: el mensaje de la API, sin perder lo escrito.
  await row.getByRole("button", { name: "Agregar variante" }).click();
  const repeated = row.getByRole("form", { name: `Nueva variante de ${productName}` });
  await repeated.getByLabel("Nombre de la variante").fill("M");
  await repeated.getByRole("button", { name: "Agregar variante" }).click();
  await expect(repeated.getByRole("alert")).toContainText("Ya hay una variante con ese nombre");
  await expect(repeated.getByLabel("Nombre de la variante")).toHaveValue("M");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/panel-variantes-${testInfo.project.name}.png`, fullPage: true });
  await repeated.getByRole("button", { name: "Cancelar" }).click();
  // Con variantes activas, el producto no muestra su propio stock (cuenta el de cada variante).
  await expect(row.locator("p").first()).not.toContainText("en stock");
});

test("un visitante elige una talla (la agotada no se puede) y pide; el pedido nombra la variante", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
  const summary = page.locator("summary", { hasText: productName });
  await expect(summary).toContainText("Desde $9.990 · Pedir");
  await summary.click();

  const form = page.getByRole("form", { name: productName });
  const options = form.getByRole("group", { name: "Elige una opción *" });
  await expect(options.getByRole("radio")).toHaveCount(3);
  await expect(options.getByRole("radio", { name: /XL/ })).toBeDisabled();
  // Sin elegir no se envía.
  await form.getByLabel("Nombre *").fill(customer);
  await form.getByLabel("Correo *").fill(`variante-${Date.now().toString(36)}@e2e.test`);
  await form.getByLabel("Dirección de entrega *").fill("Av. Siempre Viva 742, Santiago");
  await form.getByText("Acepto que este negocio").click();
  await form.getByRole("button", { name: /Hacer pedido/ }).click();
  await expect(form.getByRole("alert").filter({ hasText: "Elige una opción" })).toBeVisible();

  await options.locator('[data-variant-option="L"]').click();
  await expect(options.getByRole("radio", { name: /^L/ })).toBeChecked();
  await expect(form.getByRole("button", { name: /Hacer pedido · \$12\.990/ })).toBeVisible();
  await form.getByRole("button", { name: "Una unidad más" }).click();
  await expect(form.getByRole("button", { name: /Hacer pedido · \$25\.980/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/publico-elegir-${testInfo.project.name}.png`, fullPage: true });
  await form.getByRole("button", { name: /Hacer pedido/ }).click();

  await expect(page.getByRole("heading", { name: "¡Pedido recibido!" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "¡Pedido recibido!" })).toContainText(`2 × ${productName} (L)`);
  await page.screenshot({ path: `${CAPTURES}/publico-confirmado-${testInfo.project.name}.png`, fullPage: true });
  expect(await variantStock("L")).toBe(3);
  expect(await variantStock("M")).toBe(1);
});

test("el pedido aparece en Pedidos con su variante; cancelarlo devuelve el stock a la talla", async ({ page }, testInfo) => {
  await page.goto("/pedidos");
  const card = page.locator("[data-order]", { hasText: customer });
  await expect(card).toContainText(`2 × ${productName} (L)`);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/pedidos-${testInfo.project.name}.png`, fullPage: true });
  await card.getByRole("button", { name: new RegExp(`^Cancelar: pedido de ${customer}`) }).click();
  await expect(card).toContainText("Cancelado");
  await expect.poll(() => variantStock("L")).toBe(5);
});
