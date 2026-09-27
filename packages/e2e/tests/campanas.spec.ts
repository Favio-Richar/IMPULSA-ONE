import { readFileSync } from "node:fs";
import { signUnsubscribeToken } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_URL } from "../playwright.config.js";

// F5.6 — campañas: un cliente acepta novedades al pedir; el negocio escribe la campaña, ve a cuántos
// llega, se envía una prueba y la envía; el informe muestra el avance; el cliente se da de baja con
// el enlace firmado. Sin desplazamiento horizontal en teléfono ni escritorio.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const campaignsBase = `${API_BASE_URL}/organizations/${fixture.organizationId}/campaigns`;
const secret = process.env.BOOKING_LINK_SECRET;
const CAPTURES = ".playwright/capturas/f56";

test.skip(!secret, "BOOKING_LINK_SECRET no configurado: sin enlace de baja no se envían campañas.");
test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
let productId: string;
let campaignId: string | undefined;
const prisma = new PrismaClient();

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  const testInfo = test.info();
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  const product = await api.post(`${site}/catalog/products`, { headers: CSRF, data: { name: `Guía campañas ${testInfo.project.name}`, kind: "DIGITAL", priceAmount: 1000, priceCurrency: "CLP" } });
  expect(product.status()).toBe(201);
  productId = ((await product.json()) as { id: string }).id;
  // Un cliente que marcó "quiero recibir novedades" al pedir.
  const order = await api.post(`${API_BASE_URL}/public/sites/${fixture.siteSlug}/catalog/orders`, {
    headers: CSRF,
    data: { productId, quantity: 1, name: "Cliente novedades", email: `novedades-${testInfo.project.name}-${Date.now().toString(36)}@e2e.test`, consent: true, marketingConsent: true },
  });
  expect(order.status()).toBe(201);
});

test.afterAll(async () => {
  if (campaignId) {
    await api.post(`${campaignsBase}/${campaignId}/cancel`, { headers: CSRF });
  }
  await api.delete(`${site}/catalog/products/${productId}`, { headers: CSRF });
  await api.dispose();
  await prisma.$disconnect();
});

test("el negocio escribe una campaña, se envía una prueba, la envía y ve el avance", async ({ page }, testInfo) => {
  const name = `Otoño e2e ${testInfo.project.name} ${Date.now().toString(36)}`;
  await page.goto("/campanas");
  await expect(page.getByRole("heading", { name: "Campañas", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Nueva campaña" }).click();

  const form = page.getByRole("form", { name: "Nueva campaña" });
  await form.getByLabel("Nombre interno").fill(name);
  await form.getByLabel("Asunto").fill("Llegaron las velas de otoño");
  const editor = form.getByRole("textbox", { name: "Mensaje del correo" });
  await editor.click();
  await editor.pressSequentially("Hola, ya tenemos la colección de otoño.");
  await expect(form.locator("[data-audience]")).toHaveText(/\d+ contactos?/);
  await expectNoHorizontalScroll(page);
  await form.getByRole("button", { name: "Guardar borrador" }).click();

  await expect(page).toHaveURL(/\/campanas\/[0-9a-f-]{36}$/);
  campaignId = page.url().split("/").pop();
  const draft = page.getByRole("form", { name: `Editar ${name}` });
  await expect(draft.getByRole("button", { name: "Guardado" })).toBeDisabled();
  await draft.getByRole("button", { name: "Enviarme una prueba" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Te enviamos la prueba" })).toBeVisible();
  // La vista previa muestra el correo real, con el pie de baja.
  const preview = page.frameLocator('iframe[title="Vista previa del correo"]');
  await expect(preview.getByText("Hola, ya tenemos la colección de otoño.")).toBeVisible();
  await expect(preview.getByRole("link", { name: "Darme de baja" })).toBeVisible();
  await expect(form.getByRole("button", { name: /^Pedido · / }).or(page.getByRole("button", { name: /^Pedido · / })).first()).toBeVisible();
  await page.screenshot({ path: `${CAPTURES}/campana-editor-${testInfo.project.name}.png`, fullPage: true });

  await draft.getByRole("button", { name: /^Enviar a \d+/ }).click();
  await draft.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(page.getByText(/Enviando|Enviada/).first()).toBeVisible();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/campana-informe-${testInfo.project.name}.png`, fullPage: true });

  await page.goto("/campanas");
  await expect(page.locator("[data-campaign]", { hasText: name })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/campanas-${testInfo.project.name}.png`, fullPage: true });
});

test("el cliente se da de baja con el enlace firmado; un enlace falso da 404", async ({ page }, testInfo) => {
  expect(campaignId).toBeDefined();
  const recipient = await prisma.campaignRecipient.findFirstOrThrow({ where: { campaignId }, orderBy: { createdAt: "desc" } });
  const response = await page.goto(`${PUBLIC_WEB_URL}/baja/${signUnsubscribeToken(recipient.id, secret!)}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("heading", { name: "¿Dejar de recibir correos?" })).toBeVisible();
  await page.screenshot({ path: `${CAPTURES}/baja-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Darme de baja" }).click();
  await expect(page.getByRole("heading", { name: "Listo, te diste de baja" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  if (recipient.contactId) {
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: recipient.contactId } })).marketingUnsubscribedAt).not.toBeNull();
  }
  const fake = await page.goto(`${PUBLIC_WEB_URL}/baja/${recipient.id}.firma-falsa`);
  expect(fake?.status()).toBe(404);
});
