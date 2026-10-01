import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F7.8b (ADR-023) — cupones: el negocio crea un código desde el catálogo (y ve el error de código
// repetido); un visitante prueba un código que no existe (mensaje único), aplica el real, cambia la
// cantidad (el descuento se recalcula al volver a aplicarlo) y pide; el pedido y el cupón muestran
// el descuento y el uso. Teléfono y escritorio, sin desplazamiento horizontal.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const CAPTURES = ".playwright/capturas/f78b";

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let productId: string;
let blockId: string;
let productName: string;
let customer: string;
let code: string;

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

test.beforeAll(async () => {
  const testInfo = test.info();
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  const suffix = Date.now().toString(36).toUpperCase();
  productName = `Taller e2e ${testInfo.project.name} ${suffix}`;
  customer = `Cliente cupón ${testInfo.project.name} ${suffix}`;
  code = `E2E${testInfo.project.name.toUpperCase()}${suffix}`;
  const product = await api.post(`${site}/catalog/products`, { headers: CSRF, data: { name: productName, kind: "SERVICE", priceAmount: 10000, priceCurrency: "CLP" } });
  expect(product.status()).toBe(201);
  productId = ((await product.json()) as { id: string }).id;
  const block = await api.post(blocksPath, { headers: CSRF, data: { type: "catalog", config: { label: `Tienda cupones ${testInfo.project.name}`, productIds: [productId] } } });
  expect(block.status()).toBe(201);
  blockId = ((await block.json()) as { id: string }).id;
  expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
  await revalidate();
});

test.afterAll(async () => {
  const coupons = (await (await api.get(`${site}/coupons`)).json()) as Array<{ id: string; code: string }>;
  for (const coupon of coupons.filter((item) => item.code === code)) {
    await api.delete(`${site}/coupons/${coupon.id}`, { headers: CSRF });
  }
  await api.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
  await api.delete(`${site}/catalog/products/${productId}`, { headers: CSRF });
  await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
  await revalidate();
  await api.dispose();
});

test("el negocio crea un cupón desde el catálogo y ve el error de código repetido", async ({ page }, testInfo) => {
  await page.goto(`/sitios/${fixture.siteId}/catalogo`);
  await page.getByRole("link", { name: "Cupones" }).click();
  await expect(page.getByRole("heading", { name: "Cupones", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Nuevo cupón" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo cupón" });
  await dialog.getByRole("textbox", { name: /^Código/ }).fill(code.toLowerCase());
  await expect(dialog.getByRole("textbox", { name: /^Código/ })).toHaveValue(code);
  await dialog.getByRole("textbox", { name: /^Porcentaje/ }).fill("15");
  await dialog.getByLabel(/^Máximo de usos/).fill("5");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/editor-${testInfo.project.name}.png`, fullPage: true });
  await dialog.getByRole("button", { name: "Crear cupón" }).click();
  await expect(dialog).toBeHidden();

  const card = page.locator(`[data-coupon="${code}"]`);
  await expect(card).toContainText("15 % de descuento");
  await expect(card).toContainText("Vigente");
  await expect(card).toContainText("0 de 5 usos");
  // Un porcentaje sin mínimo vale en cualquier moneda (no queda atado a CLP).
  await expect(card).not.toContainText("Solo en");

  // El mismo código otra vez: el mensaje de la API en el campo.
  await page.getByRole("button", { name: "Nuevo cupón" }).click();
  const again = page.getByRole("dialog", { name: "Nuevo cupón" });
  await again.getByRole("textbox", { name: /^Código/ }).fill(code);
  await again.getByRole("textbox", { name: /^Porcentaje/ }).fill("10");
  await again.getByRole("button", { name: "Crear cupón" }).click();
  await expect(again.getByText("Ya hay un cupón con ese código en este sitio.")).toBeVisible();
  await again.getByRole("button", { name: "Cancelar" }).click();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/lista-${testInfo.project.name}.png`, fullPage: true });
});

test("un visitante aplica el código, cambia la cantidad, lo vuelve a aplicar y pide con el descuento", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
  await page.locator("summary", { hasText: productName }).click();
  const form = page.getByRole("form", { name: productName });

  await form.getByRole("button", { name: "¿Tienes un código de descuento?" }).click();
  const field = form.getByLabel("Código de descuento");
  await field.fill("NOEXISTE");
  await form.getByRole("button", { name: "Aplicar" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "Ese código no es válido." })).toBeVisible();

  await field.fill(code.toLowerCase());
  await form.getByRole("button", { name: "Aplicar" }).click();
  await expect(form.getByRole("status").filter({ hasText: code })).toContainText("−$1.500");
  await expect(form.getByRole("button", { name: /Hacer pedido · \$8\.500/ })).toBeVisible();

  // Cambiar la cantidad invalida el descuento calculado: se pide aplicarlo de nuevo.
  await form.getByRole("button", { name: "Una unidad más" }).click();
  await expect(form.getByText("Cambiaste el pedido: aplica el código de nuevo")).toBeVisible();
  await expect(form.getByRole("button", { name: /Hacer pedido · \$20\.000/ })).toBeVisible();
  await form.getByRole("button", { name: "Aplicar" }).click();
  await expect(form.getByRole("button", { name: /Hacer pedido · \$17\.000/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/publico-codigo-${testInfo.project.name}.png`, fullPage: true });

  await form.getByLabel("Nombre *").fill(customer);
  await form.getByLabel("Correo *").fill(`cupon-${Date.now().toString(36)}@e2e.test`);
  await form.getByText("Acepto que este negocio").click();
  await form.getByRole("button", { name: /Hacer pedido/ }).click();
  const confirmation = page.getByRole("status").filter({ hasText: "¡Pedido recibido!" });
  await expect(confirmation).toContainText(`Descuento (${code}): −$3.000`);
  await expect(confirmation).toContainText("Total: $17.000");
  await page.screenshot({ path: `${CAPTURES}/publico-confirmado-${testInfo.project.name}.png`, fullPage: true });
});

test("el pedido muestra el cupón y el cupón suma el uso y el descuento entregado", async ({ page }, testInfo) => {
  await page.goto("/pedidos");
  const card = page.locator("[data-order]", { hasText: customer });
  await expect(card).toContainText(`Cupón ${code}: −$3.000`);
  await expect(card).toContainText("$17.000");
  await page.goto(`/sitios/${fixture.siteId}/cupones`);
  const coupon = page.locator(`[data-coupon="${code}"]`);
  await expect(coupon).toContainText("1 de 5 usos");
  await expect(coupon).toContainText("$3.000 descontados");
  await coupon.getByRole("button", { name: `Pausar ${code}` }).click();
  await expect(coupon).toContainText("Pausado");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/cupon-usado-${testInfo.project.name}.png`, fullPage: true });
});
