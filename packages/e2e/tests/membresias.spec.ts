import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// F10.2 (ADR-029) — planes de membresía, en teléfono y escritorio: el negocio crea, cambia de precio, archiva y restaura planes desde su
// panel (y se le avisa que debe conectar Mercado Pago), y quien compra ve el estado de su compra con su enlace. La compra contra
// Mercado Pago se prueba en la API con la pasarela simulada: este entorno no tiene la aplicación de Mercado Pago configurada.

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/f102";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const createdEmails: string[] = [];
const createdPlanNames: string[] = [];

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba.
  await prisma.siteMember.deleteMany({ where: { siteId: fixture.siteId, email: { in: createdEmails } } });
  await prisma.membershipPlan.deleteMany({ where: { siteId: fixture.siteId, name: { in: createdPlanNames } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, OR: [{ targetType: "MembershipPlan" }, { targetType: "SiteMember" }, { targetType: "MembershipPurchase" }] } });
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

test("el negocio crea, cambia de precio, archiva y restaura un plan", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const planName = `Plan e2e ${project} ${suffix}`;
  createdPlanNames.push(planName);

  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto(`/sitios/${fixture.siteId}/miembros`);
  await expect(page.getByRole("heading", { name: "Planes de membresía" })).toBeVisible();
  // Sin cuenta de Mercado Pago conectada, se le explica qué falta y no se promete nada.
  await expect(page.getByRole("status").filter({ hasText: "conecta tu cuenta de Mercado Pago" })).toBeVisible();

  const form = page.getByRole("form", { name: "Crear plan" });
  await form.getByRole("button", { name: "Crear plan" }).click();
  await expect(form.getByRole("alert")).toContainText("Ponle un nombre al plan.");
  await form.getByLabel("Nombre del plan").fill(planName);
  await form.getByLabel("Precio (CLP)").fill("49,90");
  await form.getByRole("button", { name: "Crear plan" }).click();
  await expect(form.getByRole("alert")).toContainText("sin puntos ni decimales");

  await form.getByLabel("Precio (CLP)").fill("4990");
  await form.getByLabel("Descripción (opcional)").fill("Acceso a todas las lecturas del club.");
  await form.getByRole("button", { name: "Crear plan" }).click();
  const row = page.getByRole("listitem").filter({ hasText: planName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("$4.990 al mes");
  await expect(row).toContainText("A la venta");
  await expectNoHorizontalScroll(page);
  await capture(page, `01-planes-${project}.png`);

  // Cambiar el precio (solo afecta compras nuevas).
  await row.getByRole("button", { name: `Cambiar el precio de ${planName}` }).click();
  const priceForm = page.getByRole("form", { name: `Precio de ${planName}` });
  await priceForm.getByLabel("Nuevo precio").fill("0");
  await priceForm.getByRole("button", { name: "Guardar" }).click();
  await expect(priceForm.getByText("sin puntos ni decimales")).toBeVisible();
  await priceForm.getByLabel("Nuevo precio").fill("5990");
  await priceForm.getByRole("button", { name: "Guardar" }).click();
  await expect(row).toContainText("$5.990 al mes");

  await row.getByRole("button", { name: "Archivar" }).click();
  await expect(row).toContainText("Archivado");
  await row.getByRole("button", { name: "Volver a vender" }).click();
  await expect(row).toContainText("A la venta");
  await capture(page, `02-plan-editado-${project}.png`);
});

test("«Tu membresía»: el estado de la compra con su enlace, sin datos personales, y un enlace inventado no revela nada", async ({ browser }, testInfo) => {
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;

  // Datos sembrados directo en la base: un miembro comprador con un periodo pagado y otra compra pendiente.
  const email = `socia-${project}-${suffix}@e2e.test`;
  createdEmails.push(email);
  const planName = `Plan estado ${project} ${suffix}`;
  createdPlanNames.push(planName);
  const plan = await prisma.membershipPlan.create({
    data: { organizationId: fixture.organizationId, siteId: fixture.siteId, name: planName, priceAmount: 7990, priceCurrency: "CLP", period: "MONTHLY" },
  });
  const member = await prisma.siteMember.create({
    data: { organizationId: fixture.organizationId, siteId: fixture.siteId, email, source: "PURCHASED" },
  });
  const hash = (token: string): string => createHash("sha256").update(token).digest("hex");
  const paidToken = randomBytes(32).toString("base64url");
  const pendingToken = randomBytes(32).toString("base64url");
  const periodEnd = new Date(Date.now() + 20 * 86_400_000);
  const base = { organizationId: fixture.organizationId, siteId: fixture.siteId, planId: plan.id, memberId: member.id, planName, amount: 7990, currency: "CLP", periodDays: 30 };
  await prisma.membershipPurchase.create({
    data: {
      ...base,
      status: "PAID",
      statusTokenHash: hash(paidToken),
      providerPaymentId: `${Date.now()}${project === "movil" ? 1 : 2}`,
      paymentStatus: "approved",
      paidAt: new Date(),
      periodStart: new Date(),
      periodEnd,
    },
  });
  await prisma.membershipPurchase.create({
    data: {
      ...base,
      status: "PENDING",
      statusTokenHash: hash(pendingToken),
      checkoutPreferenceId: "pref-e2e",
      checkoutUrl: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-e2e",
      checkoutExpiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  const context = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
  const web = await context.newPage();

  await web.goto(`/membresia/${paidToken}`);
  await expect(web.getByRole("heading", { name: "Pago confirmado" })).toBeVisible();
  await expect(web.getByText(planName)).toBeVisible();
  await expect(web.getByText(/vigente hasta/)).toBeVisible();
  expect(await web.content()).not.toContain(email);
  expect(await web.content()).not.toContain("pref-e2e");
  await expectNoHorizontalScroll(web);
  await capture(web, `03-membresia-pagada-${project}.png`);

  await web.goto(`/membresia/${pendingToken}`);
  await expect(web.getByRole("heading", { name: "Compra pendiente de pago" })).toBeVisible();
  await expect(web.getByRole("link", { name: "Pagar con Mercado Pago" })).toHaveAttribute("href", /mercadopago\.cl/);
  await expectNoHorizontalScroll(web);
  await capture(web, `04-membresia-pendiente-${project}.png`);

  // Un enlace inventado: 404 de la plataforma, sin pistas.
  const missing = await web.goto(`/membresia/${randomBytes(32).toString("base64url")}`);
  expect(missing?.status()).toBe(404);
  await context.close();

  const api = await apiRequest.newContext();
  await api.dispose();
});
