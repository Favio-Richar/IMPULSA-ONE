import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { encryptSecret } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// F10.2d (ADR-030) — «Tu pedido» con Webpay Plus, en teléfono y escritorio. La transacción real contra Transbank se prueba en la API con
// el simulador: acá se verifica la interfaz (opciones de pago, error, estados de carga y el envío por POST con `token_ws`) interceptando
// la llamada al servidor, para que la prueba no dependa de la red de Transbank.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/f102";
const prisma = new PrismaClient();
const created: string[] = [];
const WEBPAY_SECRET = "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C";

test.beforeAll(async () => {
  const key = process.env.AUTH_ENCRYPTION_KEY;
  test.skip(!key, "sin AUTH_ENCRYPTION_KEY en el entorno de la prueba");
  await prisma.paymentAccount.deleteMany({ where: { organizationId: fixture.organizationId, provider: "WEBPAY_PLUS" } });
  await prisma.paymentAccount.create({
    data: {
      organizationId: fixture.organizationId,
      provider: "WEBPAY_PLUS",
      providerUserId: "597055555532",
      accessTokenEncrypted: encryptSecret(WEBPAY_SECRET, key!),
      refreshTokenEncrypted: encryptSecret("webpay-plus", key!),
      expiresAt: new Date("2999-01-01T00:00:00Z"),
      liveMode: false,
    },
  });
});

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba.
  await prisma.order.deleteMany({ where: { id: { in: created } } });
  await prisma.paymentAccount.deleteMany({ where: { organizationId: fixture.organizationId, provider: "WEBPAY_PLUS" } });
  await prisma.$disconnect();
});

async function seedOrder(input: { status: "NEW" | "PAID"; paymentStatus: string | null; customerName: string; expired?: boolean }): Promise<string> {
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
      checkoutExpiresAt: new Date(Date.now() + (input.expired ? -3_600_000 : 24 * 3_600_000)),
      paymentStatus: input.paymentStatus,
      paymentProvider: input.status === "PAID" ? "WEBPAY_PLUS" : null,
      providerPaymentId: input.status === "PAID" ? `webpay:${randomBytes(8).toString("hex")}` : null,
      status: input.status,
      paidAt: input.status === "PAID" ? new Date() : null,
      statusTokenHash: createHash("sha256").update(token).digest("hex"),
    },
  });
  created.push(order.id);
  return token;
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function capture(page: Page, file: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}`, fullPage: true });
  await page.emulateMedia({ reducedMotion: null });
}

test("esperando pago: ofrece pagar con Webpay, muestra el error del servidor y vuelve a dejar reintentar", async ({ page }, testInfo) => {
  const token = await seedOrder({ status: "NEW", paymentStatus: null, customerName: `Webpay ${testInfo.project.name}` });
  await page.goto(`${PUBLIC_WEB_URL}/pedido/${token}`);
  await expect(page.getByRole("heading", { name: "Pedido pendiente de pago" })).toBeVisible();
  await expect(page.getByText("Elige cómo pagar para confirmarlo.")).toBeVisible();
  // Sin cuenta de Mercado Pago conectada: no se ofrece.
  await expect(page.getByRole("link", { name: "Pagar con Mercado Pago" })).toHaveCount(0);
  const pay = page.getByRole("button", { name: "Pagar con Webpay" });
  await expect(pay).toBeVisible();
  expect((await pay.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByText("comprador@e2e.test")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await capture(page, `07-pedido-webpay-${testInfo.project.name}.png`);

  // El servidor no puede crear la transacción: el comprador lo ve y puede reintentar.
  await page.route("**/api/orders/webpay/*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "No pudimos iniciar el pago ahora. Intenta de nuevo en un momento." }) }),
  );
  await pay.click();
  await expect(page.getByRole("alert").filter({ hasText: "No pudimos iniciar el pago ahora" })).toBeVisible();
  await expect(pay).toBeEnabled();
  await expectNoHorizontalScroll(page);
});

test("al pagar, el navegador envía token_ws por POST a Webpay (sin salir con un enlace GET)", async ({ page }, testInfo) => {
  const token = await seedOrder({ status: "NEW", paymentStatus: null, customerName: `Envío ${testInfo.project.name}` });
  await page.goto(`${PUBLIC_WEB_URL}/pedido/${token}`);

  const webpayUrl = "https://webpay3gint.transbank.cl/webpayserver/initTransaction";
  await page.route("**/api/orders/webpay/*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ checkoutUrl: webpayUrl, method: "POST", fields: { token_ws: "01abSIMULADO0123456789" } }),
    }),
  );
  let received: { method: string; body: string | null } | null = null;
  await page.route(webpayUrl, (route) => {
    received = { method: route.request().method(), body: route.request().postData() };
    return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body><h1>Webpay simulado</h1></body></html>" });
  });
  await page.getByRole("button", { name: "Pagar con Webpay" }).click();
  await expect(page.getByRole("heading", { name: "Webpay simulado" })).toBeVisible();
  expect(received).not.toBeNull();
  expect(received!.method).toBe("POST");
  expect(received!.body).toContain("token_ws=01abSIMULADO0123456789");
});

test("pagado o vencido: no ofrece pagar con Webpay", async ({ page }, testInfo) => {
  const paid = await seedOrder({ status: "PAID", paymentStatus: "approved", customerName: `Pagado ${testInfo.project.name}` });
  await page.goto(`${PUBLIC_WEB_URL}/pedido/${paid}`);
  await expect(page.getByRole("heading", { name: "Pago confirmado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pagar con Webpay" })).toHaveCount(0);

  const expired = await seedOrder({ status: "NEW", paymentStatus: null, customerName: `Vencido ${testInfo.project.name}`, expired: true });
  await page.goto(`${PUBLIC_WEB_URL}/pedido/${expired}`);
  await expect(page.getByText(/El plazo para pagar en línea venció/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pagar con Webpay" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("el servidor no toma montos del visitante ni acepta enlaces inventados", async ({ request }) => {
  const response = await request.post(`${PUBLIC_WEB_URL}/api/orders/webpay/${randomBytes(32).toString("base64url")}`);
  expect(response.status()).toBe(404);
});
