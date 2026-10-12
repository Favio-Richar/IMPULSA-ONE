import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// F10.4 (ADR-029) — tarjeta digital, en teléfono y escritorio: el negocio la crea desde el panel, el visitante la ve con su QR y
// descarga la vCard, y mientras no haya credenciales de wallet el pase responde «no disponible» sin romper nada. Al desactivarla,
// la página, la vCard y los pases desaparecen.

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/f104";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba.
  await prisma.digitalCard.deleteMany({ where: { siteId: fixture.siteId } });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, targetType: "DigitalCard" } });
  await prisma.$disconnect();
});

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function capture(page: Page, file: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}`, fullPage: true });
  await page.emulateMedia({ reducedMotion: null });
}

test("crear la tarjeta, verla, descargar la vCard, wallet sin credenciales y desactivarla", async ({ browser, page }, testInfo) => {
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const name = `Ana ${project} ${suffix}`;

  // --- Panel: crear la tarjeta por la interfaz ---
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto(`/sitios/${fixture.siteId}/tarjeta`);
  await expect(page.getByRole("heading", { name: "Tarjeta digital", exact: true })).toBeVisible();

  const form = page.getByRole("form", { name: "Datos de la tarjeta" });
  await form.getByRole("button", { name: "Guardar tarjeta" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "Escribe tu nombre." })).toBeVisible();

  await form.getByLabel("Nombre completo").fill(name);
  await form.getByLabel("Cargo").fill("Fotógrafa");
  await form.getByLabel("Empresa o marca").fill("Estudio Luz");
  await form.getByLabel("Teléfono").fill("912345678");
  await form.getByRole("button", { name: "Guardar tarjeta" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "formato internacional" })).toBeVisible();
  await form.getByLabel("Teléfono").fill("+56912345678");
  await form.getByLabel("Correo").fill("ana@estudioluz.cl");
  await form.getByLabel("Presentación").fill("Fotografía de retrato y moda.");
  await form.getByRole("button", { name: "Agregar red" }).click();
  await form.getByLabel("Dirección del perfil").fill("https://instagram.com/estudioluz");
  await form.getByRole("button", { name: "Guardar tarjeta" }).click();
  await expect(page.getByText("Tarjeta guardada.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tu tarjeta está activa" })).toBeVisible();
  await expect(page.getByLabel("Código QR de tu tarjeta")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `01-panel-${project}.png`);

  // --- Visitante: la tarjeta, el QR y la vCard ---
  const visitor = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
  const web = await visitor.newPage();
  await web.goto(`/${fixture.siteSlug}/t`);
  await expect(web.getByRole("heading", { name })).toBeVisible();
  await expect(web.getByText("Fotógrafa · Estudio Luz")).toBeVisible();
  await expect(web.getByRole("link", { name: "Guardar contacto" })).toBeVisible();
  await expect(web.getByRole("link", { name: "Escribir por WhatsApp" })).toHaveCount(0);
  await expect(web.getByRole("link", { name: "Llamar" })).toHaveAttribute("href", "tel:+56912345678");
  await expect(web.getByRole("link", { name: "Instagram" })).toHaveAttribute("href", "https://instagram.com/estudioluz");
  await expect(web.getByRole("img", { name: /Código QR de la tarjeta/ })).toBeVisible();
  await expectNoHorizontalScroll(web);
  await capture(web, `02-tarjeta-${project}.png`);

  const vcard = await web.request.get(`/${fixture.siteSlug}/t/vcard`);
  expect(vcard.status()).toBe(200);
  expect(vcard.headers()["content-type"]).toContain("text/vcard");
  expect(vcard.headers()["content-disposition"]).toContain("attachment");
  const text = await vcard.text();
  expect(text).toContain("BEGIN:VCARD");
  expect(text).toContain(`FN:${name}`);
  expect(text).toContain("TEL;TYPE=CELL,VOICE:+56912345678");

  // --- Wallet sin credenciales: no se ofrece el botón y la ruta responde «no disponible» ---
  await expect(web.getByRole("link", { name: "Agregar a Apple Wallet" })).toHaveCount(0);
  await expect(web.getByRole("button", { name: "Agregar a Google Wallet" })).toHaveCount(0);
  const apple = await web.request.get(`/${fixture.siteSlug}/t/apple`);
  expect(apple.status()).toBe(503);
  expect(await apple.text()).toContain("no está disponible");

  // --- Desactivar: todo desaparece en el acto ---
  await page.getByLabel("Tarjeta activa (visible para cualquiera con el enlace)").uncheck();
  await form.getByRole("button", { name: "Guardar tarjeta" }).click();
  await expect(page.getByRole("heading", { name: "Tu tarjeta está desactivada" })).toBeVisible();
  const gone = await web.goto(`/${fixture.siteSlug}/t`);
  expect(gone?.status()).toBe(404);
  expect((await web.request.get(`/${fixture.siteSlug}/t/vcard`)).status()).toBe(404);

  await visitor.close();
});

test("una tarjeta que no existe responde 404 sin pistas", async ({ browser }, testInfo) => {
  const use = testInfo.project.use as BrowserContextOptions;
  const context = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
  const web = await context.newPage();
  const response = await web.goto(`/sitio-que-no-existe-${suffix}/t`);
  expect(response?.status()).toBe(404);
  await context.close();
});
