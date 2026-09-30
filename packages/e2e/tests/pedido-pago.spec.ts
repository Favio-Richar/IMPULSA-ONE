import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// F5.9 — "Tu pedido": a donde vuelve el comprador desde Mercado Pago. Este ambiente local no tiene
// la aplicación de Impulza en Mercado Pago: los pedidos con cobro se siembran en la base con su
// enlace (el cobro, el aviso y la consulta del pago están probados en apps/api con la simulación).
// Teléfono y escritorio: esperando pago, pago en revisión y pagado; el panel lo muestra sin
// "Deshacer pago".

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f59";
const prisma = new PrismaClient();
const created: string[] = [];

test.afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

async function seedOrder(input: { status: "NEW" | "PAID"; paymentStatus: string | null; paymentId?: string; customerName: string }): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const order = await prisma.order.create({
    data: {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      productName: "Torta de chocolate",
      productKind: "SERVICE",
      unitPriceAmount: 12_990,
      priceCurrency: "CLP",
      quantity: 2,
      totalAmount: 25_980,
      customerName: input.customerName,
      customerEmail: "comprador@e2e.test",
      checkoutPreferenceId: "pref-e2e",
      checkoutUrl: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-e2e",
      checkoutExpiresAt: new Date(Date.now() + 24 * 3_600_000),
      paymentStatus: input.paymentStatus,
      providerPaymentId: input.paymentId ?? null,
      status: input.status,
      paidAt: input.status === "PAID" ? new Date() : null,
      statusTokenHash: createHash("sha256").update(token).digest("hex"),
    },
  });
  created.push(order.id);
  return token;
}

async function capture(page: Page, file: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}`, fullPage: true });
  await page.emulateMedia({ reducedMotion: null });
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("esperando pago: ofrece pagar con Mercado Pago en la misma pestaña, sin indexarse", async ({ page }, testInfo) => {
  const token = await seedOrder({ status: "NEW", paymentStatus: null, customerName: `Espera ${testInfo.project.name}` });
  const response = await page.goto(`${PUBLIC_WEB_URL}/pedido/${token}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("heading", { name: "Pedido pendiente de pago" })).toBeVisible();
  await expect(page.getByText("2 × Torta de chocolate")).toBeVisible();
  await expect(page.getByText("$25.980")).toBeVisible();
  const pay = page.getByRole("link", { name: "Pagar con Mercado Pago" });
  await expect(pay).toHaveAttribute("href", /^https:\/\/www\.mercadopago\.cl\//);
  await expect(pay).not.toHaveAttribute("target", "_blank");
  // El botón de pago es fácil de tocar en un teléfono (≥ 44 px, WCAG 2.5.8 holgado).
  expect((await pay.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // Sin datos personales en la página: el enlace puede quedar en un computador compartido.
  await expect(page.getByText("comprador@e2e.test")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await capture(page, `pendiente-${testInfo.project.name}.png`);
});

test("pago en revisión: lo explica y deja actualizar el estado", async ({ page }, testInfo) => {
  const token = await seedOrder({ status: "NEW", paymentStatus: "in_process", customerName: `Revisión ${testInfo.project.name}` });
  await page.goto(`${PUBLIC_WEB_URL}/pedido/${token}`);
  await expect(page.getByRole("heading", { name: "Pago en revisión" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Actualizar estado" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `en-revision-${testInfo.project.name}.png`);
});

test("pagado: confirma el pago sin ofrecer pagar de nuevo; un enlace falso da 404", async ({ page }, testInfo) => {
  const token = await seedOrder({ status: "PAID", paymentStatus: "approved", paymentId: `${Date.now()}`, customerName: `Pagado ${testInfo.project.name}` });
  await page.goto(`${PUBLIC_WEB_URL}/pedido/${token}`);
  await expect(page.getByRole("heading", { name: "Pago confirmado" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pagar con Mercado Pago" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await capture(page, `pagado-${testInfo.project.name}.png`);

  const fake = await page.goto(`${PUBLIC_WEB_URL}/pedido/${randomBytes(32).toString("base64url")}`);
  expect(fake?.status()).toBe(404);
});

test("el panel muestra el cobro en línea y no deja deshacer un pago confirmado por Mercado Pago", async ({ page }, testInfo) => {
  const paymentId = `${Date.now()}9`;
  const name = `Panel ${testInfo.project.name} ${paymentId}`;
  await seedOrder({ status: "PAID", paymentStatus: "approved", paymentId, customerName: name });
  await page.goto("/pedidos");
  const card = page.locator("li[data-order]", { hasText: name });
  await expect(card).toBeVisible();
  await expect(card.getByText(`Pagado con Mercado Pago · pago ${paymentId}`)).toBeVisible();
  await expect(card.getByRole("button", { name: /Deshacer pago/ })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Marcar entregado/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `panel-${testInfo.project.name}.png`);
});
