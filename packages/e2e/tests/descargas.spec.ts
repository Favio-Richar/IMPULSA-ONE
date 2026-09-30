import { readFileSync } from "node:fs";
import { signOrderDownloadToken } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_URL } from "../playwright.config.js";

// F5.11b (ADR-015) — de punta a punta contra el MinIO real: el negocio sube el archivo de un
// producto digital al bucket PRIVADO desde el catálogo; el comprador de un pedido pagado lo baja
// desde su página de descarga (formulario POST → URL firmada de 5 minutos) y uno sin pagar no.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const CAPTURES = ".playwright/capturas/f511b";
const catalog = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}/catalog`;
const secret = process.env.BOOKING_LINK_SECRET;
const prisma = new PrismaClient();
const PDF = Buffer.from("%PDF-1.7\nGuía de cerámica para principiantes\n");

test.skip(!secret || !process.env.STORAGE_PRIVATE_BUCKET, "Sin BOOKING_LINK_SECRET o STORAGE_PRIVATE_BUCKET no hay descargas.");

let productId = "";
let productName = "";

test.afterAll(async () => {
  if (productId) {
    await prisma.order.deleteMany({ where: { productId } });
  }
  await prisma.$disconnect();
});

async function capture(page: Page, file: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}`, fullPage: true });
  await page.emulateMedia({ reducedMotion: null });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/**
 * El pedido se siembra en la base: el pedido público ya lo prueban `tienda.spec.ts` y apps/api, y
 * crearlo por la ruta pública en cada corrida choca con su límite de tasa por visitante (10 cada 10
 * minutos), que es justamente lo que tiene que hacer.
 */
async function placeOrder(name: string): Promise<string> {
  const order = await prisma.order.create({
    data: {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      productId,
      productName,
      productKind: "DIGITAL",
      unitPriceAmount: 4_990,
      priceCurrency: "CLP",
      quantity: 1,
      totalAmount: 4_990,
      customerName: name,
      customerEmail: `descarga-${Date.now().toString(36)}@e2e.test`,
    },
  });
  return order.id;
}

test("el negocio sube el archivo de un producto digital al bucket privado", async ({ page }, testInfo) => {
  productName = `Guía e2e ${testInfo.project.name} ${Date.now().toString(36)}`;
  const created = await page.request.post(`${catalog}/products`, {
    headers: CSRF,
    data: { name: productName, kind: "DIGITAL", priceAmount: 4_990, priceCurrency: "CLP" },
  });
  expect(created.status()).toBe(201);
  productId = ((await created.json()) as { id: string }).id;

  await page.goto(`/sitios/${fixture.siteId}/catalogo`);
  const box = page.locator(`[data-product-file="${productName}"]`);
  await expect(box).toContainText("Sin archivo");
  await box.locator('input[type="file"]').setInputFiles({ name: "Guía de cerámica.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(box.getByRole("alert")).toHaveCount(0);
  await expect(box).toContainText("Guía de cerámica.pdf", { timeout: 15_000 });
  await expect(box).toContainText("se entrega al pagar");
  await expect(box.getByRole("button", { name: `Reemplazar archivo de ${productName}` })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `catalogo-${testInfo.project.name}.png`);

  // El objeto quedó en el bucket privado: su clave no se lee sin firma.
  const file = await prisma.productFile.findFirstOrThrow({ where: { productId, status: "READY" } });
  const direct = await page.request.get(`${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_PRIVATE_BUCKET}/org/${fixture.organizationId}/products/${productId}/${file.id}`);
  expect(direct.status()).toBe(403);
});

test("sin pagar no se descarga; pagado, el botón entrega el archivo con su nombre", async ({ page }, testInfo) => {
  const unpaid = await placeOrder("Sin pagar");
  await page.goto(`${PUBLIC_WEB_URL}/pedido/descarga/${signOrderDownloadToken(unpaid, secret!)}`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByText("todavía no está pagado")).toBeVisible();
  await expect(page.getByRole("button", { name: "Descargar" })).toHaveCount(0);

  const paid = await placeOrder("Pagado");
  const marked = await page.request.patch(`${API_BASE_URL}/organizations/${fixture.organizationId}/orders/${paid}`, { headers: CSRF, data: { status: "PAID" } });
  expect(marked.status()).toBe(200);
  await page.goto(`${PUBLIC_WEB_URL}/pedido/descarga/${signOrderDownloadToken(paid, secret!)}`);
  await expect(page.getByRole("heading", { name: productName })).toBeVisible();
  await expect(page.getByText("Te quedan 20 descargas")).toBeVisible();
  const button = page.getByRole("button", { name: "Descargar" });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalScroll(page);
  await capture(page, `descarga-${testInfo.project.name}.png`);

  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe("Guía de cerámica.pdf");
  const path = await download.path();
  expect(readFileSync(path!).equals(PDF)).toBe(true);
  expect((await prisma.order.findUniqueOrThrow({ where: { id: paid } })).downloadCount).toBe(1);

  // Un enlace falso no muestra nada.
  const fake = await page.goto(`${PUBLIC_WEB_URL}/pedido/descarga/${paid}.firma-falsa`);
  expect(fake?.status()).toBe(404);
});
