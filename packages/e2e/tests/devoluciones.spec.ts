import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F5.11a — devolver dinero desde el panel: el control se abre en su lugar con lo que queda por
// devolver, valida el monto antes de enviar y muestra la respuesta del servidor. Este ambiente no
// tiene la aplicación de Impulza en Mercado Pago, así que el servidor responde que la cuenta no
// está conectada (la devolución real está probada en apps/api con la simulación de Mercado Pago).
// Un contracargo se ve en el pedido.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f511a";
const prisma = new PrismaClient();
const created: string[] = [];

test.afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

async function paidOrder(customerName: string, paymentStatus = "approved", refundedAmount = 0) {
  const order = await prisma.order.create({
    data: {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      productName: "Curso de cerámica",
      productKind: "SERVICE",
      unitPriceAmount: 20_000,
      priceCurrency: "CLP",
      quantity: 2,
      totalAmount: 40_000,
      customerName,
      customerEmail: "devoluciones@e2e.test",
      checkoutPreferenceId: "pref-e2e",
      providerPaymentId: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
      paymentStatus,
      refundedAmount,
      status: "PAID",
      paidAt: new Date(),
    },
  });
  created.push(order.id);
  return order;
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

test("devolver dinero: lo que queda ya escrito, monto validado y la respuesta del servidor a la vista", async ({ page }, testInfo) => {
  const name = `Devolución ${testInfo.project.name} ${Date.now().toString(36)}`;
  await paidOrder(name, "approved", 15_000);
  await page.goto("/pedidos");
  const card = page.locator("li[data-order]", { hasText: name });
  await expect(card).toContainText("Devolviste $15.000 al comprador");

  await card.getByRole("button", { name: `Devolver dinero: pedido de ${name}` }).click();
  const form = card.getByRole("form", { name: `Devolver dinero: pedido de ${name}` });
  const amount = form.getByLabel(/Monto a devolver \(quedan \$25\.000\)/);
  await expect(amount).toHaveValue("25000");
  await expect(form.getByRole("button", { name: "Devolver $25.000" })).toBeVisible();

  // Más de lo que queda: se corrige antes de enviar.
  await amount.fill("30.000");
  await form.getByRole("button", { name: "Devolver" }).click();
  await expect(form.getByRole("alert")).toContainText("entre $1 y $25.000");

  await amount.fill("5.000");
  // Al corregir el monto, el aviso desaparece.
  await expect(form.getByRole("alert")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await capture(page, `devolver-${testInfo.project.name}.png`);
  await form.getByRole("button", { name: "Devolver $5.000" }).click();
  // Sin la aplicación de Mercado Pago en este ambiente, el servidor lo explica y no cambia nada.
  await expect(form.getByRole("alert")).toContainText("no está conectada");
  await form.getByRole("button", { name: "Cancelar" }).click();
  await expect(card.getByRole("button", { name: `Devolver dinero: pedido de ${name}` })).toBeVisible();
});

test("un contracargo se ve en el pedido y no ofrece devolver", async ({ page }, testInfo) => {
  const name = `Contracargo ${testInfo.project.name} ${Date.now().toString(36)}`;
  await paidOrder(name, "charged_back");
  await page.goto("/pedidos");
  const card = page.locator("li[data-order]", { hasText: name });
  await expect(card).toContainText("Contracargo en Mercado Pago");
  await expect(card.getByRole("button", { name: /Devolver dinero/ })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await capture(page, `contracargo-${testInfo.project.name}.png`);
});
