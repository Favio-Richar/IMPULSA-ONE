import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { Redis } from "ioredis";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F4.6c — contratar, cancelar, reanudar y retracto desde "Plan y pagos", teléfono y escritorio.
// - Contratar: el resumen con neto/IVA, las dos aceptaciones obligatorias y la ida a Webpay con un
//   token **real** del ambiente de integración de Transbank (la API llama de verdad). Solo se
//   intercepta la página final de Transbank: completar su formulario externo no es parte de lo que
//   probamos y volvería la prueba dependiente de su interfaz.
// - La suscripción se siembra en la base para probar la tarjeta sin cobrar, y se borra al final:
//   la organización es compartida y las demás pruebas cuentan con el plan Gratis.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f46c";
const prisma = new PrismaClient();
const DAY = 24 * 3_600_000;

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

// Cada prueba parte sin cupo gastado en los límites de facturación (contratar 10/10 min, retracto
// 5/10 min): se corre en teléfono y escritorio, y varias veces seguidas en desarrollo.
test.beforeEach(async () => {
  const keys = await redis.keys("ratelimit:billing-*");
  if (keys.length > 0) await redis.del(...keys);
});

test.afterAll(async () => {
  await clearBilling();
  await prisma.$disconnect();
  redis.disconnect();
});

async function clearBilling(): Promise<void> {
  await prisma.payment.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.subscription.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.billingCheckout.deleteMany({ where: { organizationId: fixture.organizationId } });
}

/** Captura estable: sin animaciones de entrada a medio camino (la preferencia la respeta el CSS). */
async function capture(page: Page, file: string, fullPage = false): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}`, fullPage });
  await page.emulateMedia({ reducedMotion: null });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Suscripción Profesional mensual activa, pagada hace `paidDaysAgo` días. */
async function seedSubscription(paidDaysAgo: number) {
  await clearBilling();
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "profesional" } });
  const start = new Date(Date.now() - paidDaysAgo * DAY);
  const end = new Date(start.getTime() + 30 * DAY);
  const subscription = await prisma.subscription.create({
    data: {
      organizationId: fixture.organizationId,
      planId: plan.id,
      status: "ACTIVE",
      gateway: "WEBPAY_ONECLICK",
      billingCycle: "MONTHLY",
      currentPeriodStart: start,
      currentPeriodEnd: end,
      nextChargeAt: end,
      firstPaidAt: start,
      cardBrand: "Visa",
      cardLast4: "6623",
    },
  });
  await prisma.payment.create({
    data: {
      organizationId: fixture.organizationId,
      subscriptionId: subscription.id,
      gateway: "WEBPAY_ONECLICK",
      buyOrder: `E2E${Date.now().toString(36).toUpperCase()}`,
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
  return subscription;
}

test("contratar: resumen con IVA, aceptaciones obligatorias y salida a Webpay con un token real", async ({ page }, testInfo) => {
  await clearBilling();
  // Página final de Transbank interceptada: guarda lo que el panel le envía por POST.
  let posted: string | null = null;
  await page.route("https://webpay3gint.transbank.cl/**", async (route) => {
    posted = route.request().postData();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<html><body><h1>Webpay (simulado en la prueba)</h1></body></html>" });
  });

  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Elige el plan para tu negocio" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `planes-${testInfo.project.name}.png`, true);

  await page.getByTestId("plan-card-profesional").getByRole("button", { name: "Elegir Profesional" }).click();
  const dialog = page.getByRole("dialog", { name: "Contratar el plan Profesional" });
  await expect(dialog.getByTestId("checkout-total")).toHaveText("$7.990");
  await expect(dialog).toContainText("IVA (19 %)");
  await expect(dialog).toContainText("$1.276");
  await expect(dialog).toContainText("Se renueva automáticamente");

  const pay = dialog.getByTestId("pay-button");
  await expect(pay).toBeDisabled();
  await dialog.getByLabel(/Acepto los Términos del servicio/).check();
  await expect(pay).toBeDisabled();
  await dialog.getByLabel(/derecho a retracto/).check();
  await expect(pay).toBeEnabled();
  await expect(dialog.getByRole("link", { name: "Términos del servicio" })).toHaveAttribute("href", /\/terminos$/);
  await capture(page, `resumen-${testInfo.project.name}.png`);

  await pay.click();
  await expect(page.getByRole("heading", { name: "Webpay (simulado en la prueba)" })).toBeVisible();
  expect(posted).toMatch(/^TBK_TOKEN=[0-9a-f]{64}$/);

  // Quedó la prueba de la aceptación legal, con su versión.
  const acceptances = await prisma.legalAcceptance.findMany({ where: { organizationId: fixture.organizationId, context: "checkout" }, orderBy: { acceptedAt: "desc" }, take: 2 });
  expect(acceptances.map((a) => a.document).sort()).toEqual(["terms", "withdrawal_notice"]);
});

test("al volver de Webpay, cada resultado se explica con claridad", async ({ page }, testInfo) => {
  await clearBilling();
  await page.goto("/plan?pago=rechazado");
  const banner = page.getByTestId("payment-result");
  await expect(banner).toContainText("El pago no se completó");
  await expect(banner).toContainText("No se hizo ningún cobro");
  await capture(page, `rechazado-${testInfo.project.name}.png`);

  await banner.getByRole("button", { name: "Cerrar aviso" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(banner).toBeHidden();

  await page.goto("/plan?pago=exito");
  await expect(page.getByTestId("payment-result")).toContainText("Tu plan ya está activo");
  await page.goto("/plan?pago=cualquier-cosa");
  await expect(page.getByTestId("payment-result")).toBeHidden();
});

test("la suscripción: tarjeta, cancelar con un clic, reanudar e historial con neto e IVA", async ({ page }, testInfo) => {
  await seedSubscription(2);
  await page.goto("/plan");

  const card = page.getByRole("region", { name: "Plan Profesional", exact: true });
  await expect(card.getByTestId("subscription-status")).toHaveText("Activo");
  await expect(card).toContainText("Visa terminada en 6623");
  await expect(card).toContainText("derecho a retracto hasta el");
  await expect(page.getByRole("heading", { name: "Uso del plan Profesional" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Historial de pagos" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "$6.714" })).toContainText("Pagado");
  await expectNoHorizontalScroll(page);
  await capture(page, `suscripcion-${testInfo.project.name}.png`, true);

  await card.getByRole("button", { name: "Cancelar plan" }).click();
  await expect(card).toContainText("¿Cancelar? Seguirá activo hasta el");
  await card.getByRole("button", { name: "Sí" }).click();
  await expect(card.getByTestId("subscription-status")).toHaveText("Cancelado");
  await expect(card).toContainText("No se volverá a cobrar");
  // Sigue con el plan hasta el fin del período.
  await expect(page.getByRole("heading", { name: "Uso del plan Profesional" })).toBeVisible();
  await capture(page, `cancelado-${testInfo.project.name}.png`);

  await card.getByRole("button", { name: "Reanudar plan" }).click();
  await expect(card.getByTestId("subscription-status")).toHaveText("Activo");
  await expect(card).toContainText("Se renueva el");
});

test("retracto: si Webpay no reembolsa, se dice con claridad y el plan queda igual", async ({ page }) => {
  // La orden sembrada no existe en Transbank: el reembolso real falla y la pantalla debe decirlo sin
  // tocar el plan (la ruta feliz del reembolso está en apps/api, con la pasarela simulada).
  await seedSubscription(2);
  await page.goto("/plan");
  const card = page.getByRole("region", { name: "Plan Profesional", exact: true });
  await card.getByRole("button", { name: "Cancelar y pedir reembolso" }).click();
  await expect(card).toContainText("¿Cancelar ahora y reembolsar $7.990?");
  await card.getByRole("button", { name: "Sí" }).click();
  await expect(card.getByRole("alert")).toContainText("Webpay no pudo procesar el reembolso");
  await expect(card.getByTestId("subscription-status")).toHaveText("Activo");
});

test("pasados los 10 días ya no se ofrece el retracto, solo cancelar", async ({ page }) => {
  await seedSubscription(12);
  await page.goto("/plan");
  const card = page.getByRole("region", { name: "Plan Profesional", exact: true });
  await expect(card.getByRole("button", { name: "Cancelar plan" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Cancelar y pedir reembolso" })).toBeHidden();
  await expect(card).not.toContainText("derecho a retracto");
});

test("con dos pasarelas se elige cómo pagar, y Mercado Pago lleva a su sitio", async ({ page }, testInfo) => {
  await clearBilling();
  // Este ambiente local no tiene credenciales de Mercado Pago: se simula solo lo que la API
  // respondería con ellas (la lista de pasarelas y la URL de autorización). La API real está
  // probada en apps/api con la pasarela simulada.
  await page.route("**/api/v1/organizations/*/billing", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, gateways: ["WEBPAY_ONECLICK", "MERCADO_PAGO"] } });
  });
  let requested: unknown = null;
  await page.route("**/api/v1/organizations/*/billing/checkout", async (route) => {
    requested = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { url: "https://www.mercadopago.cl/subscriptions/checkout?preapproval_id=2c9380849", method: "GET", fields: {} } });
  });
  await page.route("https://www.mercadopago.cl/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body><h1>Mercado Pago (simulado en la prueba)</h1></body></html>" }),
  );

  await page.goto("/plan");
  await page.getByTestId("plan-card-profesional").getByRole("button", { name: "Elegir Profesional" }).click();
  const dialog = page.getByRole("dialog", { name: "Contratar el plan Profesional" });
  await expect(dialog.getByRole("group", { name: "¿Cómo quieres pagar?" })).toBeVisible();
  await expect(dialog.getByTestId("pay-button")).toContainText("con Webpay");

  await dialog.getByRole("radio", { name: /Mercado Pago/ }).check();
  await expect(dialog.getByTestId("pay-button")).toContainText("Pagar $7.990 con Mercado Pago");
  await expect(dialog).toContainText("Autorizarás el cobro en el sitio de Mercado Pago");
  await dialog.getByLabel(/Acepto los Términos del servicio/).check();
  await dialog.getByLabel(/derecho a retracto/).check();
  await capture(page, `mercado-pago-${testInfo.project.name}.png`);
  await dialog.getByTestId("pay-button").click();

  await expect(page.getByRole("heading", { name: "Mercado Pago (simulado en la prueba)" })).toBeVisible();
  expect(requested).toMatchObject({ planCode: "profesional", cycle: "MONTHLY", gateway: "MERCADO_PAGO", acceptTerms: true, acceptWithdrawalNotice: true });
});
