import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_SESSION_PATH, FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { ADMIN_URL } from "../playwright.config.js";

// F4.6d — Facturación en la superadministración, contra la API y el panel reales: el resumen de
// ingresos, el cobro sembrado en la lista de boletas pendientes, marcar la boleta con su folio, la
// planilla CSV del mes y el reembolso (Transbank no conoce la orden sembrada: la pantalla debe decir
// que no se pudo y dejar el cobro igual). Teléfono y escritorio.

test.use({ baseURL: ADMIN_URL, storageState: ADMIN_SESSION_PATH });
test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f46d";
const prisma = new PrismaClient();
const DAY = 24 * 3_600_000;

async function clearBilling(): Promise<void> {
  await prisma.payment.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.subscription.deleteMany({ where: { organizationId: fixture.organizationId } });
}

test.afterAll(async () => {
  await clearBilling();
  await prisma.$disconnect();
});

async function capture(page: Page, file: string, fullPage = false): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}`, fullPage });
  await page.emulateMedia({ reducedMotion: null });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Un cobro pagado de la organización sembrada, sin boleta. */
async function seedPaidPayment() {
  await clearBilling();
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "profesional" } });
  const start = new Date(Date.now() - DAY);
  const end = new Date(start.getTime() + 30 * DAY);
  const subscription = await prisma.subscription.create({
    data: {
      organizationId: fixture.organizationId,
      planId: plan.id,
      status: "ACTIVE",
      gateway: "WEBPAY_ONECLICK",
      currentPeriodStart: start,
      currentPeriodEnd: end,
      nextChargeAt: end,
      firstPaidAt: start,
      cardLast4: "6623",
    },
  });
  return prisma.payment.create({
    data: {
      organizationId: fixture.organizationId,
      subscriptionId: subscription.id,
      gateway: "WEBPAY_ONECLICK",
      buyOrder: `E2EADM${Date.now().toString(36).toUpperCase()}`,
      amount: 7_990,
      netAmount: 6_714,
      vatAmount: 1_276,
      currency: "CLP",
      periodStart: start,
      periodEnd: end,
      status: "APPROVED",
      paidAt: start,
    },
  });
}

test("ingresos: el resumen, la boleta pendiente con su folio y la planilla del mes", async ({ page }, testInfo) => {
  const payment = await seedPaidPayment();
  await page.goto("/facturacion");
  await expect(page.getByRole("heading", { name: "Facturación", level: 1 })).toBeVisible();
  await expect(page.getByText("Ingreso mensual recurrente")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ingreso mensual por plan" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `resumen-${testInfo.project.name}.png`, true);

  // Desde la cifra de boletas por emitir se llega a la lista de pendientes.
  await page.getByRole("button", { name: /Boletas por emitir/ }).click();
  await expect(page.getByRole("tab", { name: "Boletas pendientes" })).toHaveAttribute("aria-selected", "true");
  const row = page.getByTestId(`payment-${payment.id}`);
  await expect(row).toContainText("$7.990");
  await expect(row).toContainText("neto $6.714 · IVA $1.276");

  await row.getByRole("button", { name: "Marcar emitida" }).click();
  const dialog = page.getByRole("dialog", { name: "Marcar la boleta como emitida" });
  await dialog.getByLabel("Folio del documento").fill("12a");
  await dialog.getByRole("button", { name: "Guardar folio" }).click();
  await expect(dialog).toContainText("solo dígitos");
  await dialog.getByLabel("Folio del documento").fill("104233");
  await capture(page, `folio-${testInfo.project.name}.png`);
  await dialog.getByRole("button", { name: "Guardar folio" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toBeHidden(); // ya no está pendiente
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).taxDocumentNumber).toBe("104233");

  await page.getByRole("tab", { name: "Todos" }).click();
  await expect(page.getByTestId(`payment-${payment.id}`)).toContainText("N° 104233");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Planilla del mes (CSV)" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^impulza-cobros-\d{4}-\d{2}\.csv$/);
  const content = readFileSync((await file.path())!, "utf8");
  expect(content).toContain(payment.buyOrder);
  expect(content).toContain('"Emitida","104233"');
});

test("reembolso: exige motivo, avisa de la nota de crédito, y si Transbank falla el cobro queda igual", async ({ page }, testInfo) => {
  const payment = await seedPaidPayment();
  await prisma.payment.update({ where: { id: payment.id }, data: { taxDocumentStatus: "ISSUED", taxDocumentNumber: "900" } });
  await page.goto("/facturacion");
  const row = page.getByTestId(`payment-${payment.id}`);
  await row.getByRole("button", { name: "Reembolsar" }).click();

  const dialog = page.getByRole("dialog", { name: "Reembolsar $7.990" });
  await expect(dialog).toContainText("nota de crédito");
  const confirm = dialog.getByRole("button", { name: "Reembolsar $7.990" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Motivo").fill("Cobro duplicado reportado por el cliente");
  await expect(confirm).toBeEnabled();
  await capture(page, `reembolso-${testInfo.project.name}.png`);
  await confirm.click();
  await expect(dialog.getByRole("alert")).toContainText("Transbank no procesó el reembolso");
  expect(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({ status: "APPROVED", refundedAmount: 0 });
});

test("el detalle de la organización muestra su suscripción y sus pagos", async ({ page }) => {
  await seedPaidPayment();
  await page.goto(`/organizaciones/${fixture.organizationId}`);
  const section = page.getByRole("region", { name: "Suscripción y pagos" });
  await expect(section).toContainText("Activa");
  await expect(section).toContainText("•••• 6623");
  await expect(section).toContainText("$7.990");
  await expect(section.getByRole("link", { name: "Ver facturación" })).toHaveAttribute("href", "/facturacion");
});
