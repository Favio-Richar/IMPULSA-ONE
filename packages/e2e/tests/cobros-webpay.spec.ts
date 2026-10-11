import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { encryptSecret } from "@impulza/auth";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F10.2c (ADR-030) — Cobros › Webpay Plus, en teléfono y escritorio: el formulario valida antes de enviar, una cuenta conectada se
// muestra sin revelar la llave (solo los últimos 4 dígitos del comercio) y se puede desconectar. La conexión real contra Transbank se
// prueba en la API con el simulador: este entorno no depende de la red de Transbank.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/f102";
const prisma = new PrismaClient();
const SECRET = "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C";

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba.
  await prisma.paymentAccount.deleteMany({ where: { organizationId: fixture.organizationId, provider: "WEBPAY_PLUS" } });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, targetType: "payment_account", action: "payments.account_disconnected" } });
  await prisma.$disconnect();
});

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("Webpay Plus: valida el formulario, muestra la cuenta conectada sin la llave y permite desconectarla", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await prisma.paymentAccount.deleteMany({ where: { organizationId: fixture.organizationId, provider: "WEBPAY_PLUS" } });
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto("/cobros");
  await expect(page.getByRole("heading", { name: "Webpay Plus (Transbank)" })).toBeVisible();
  await expect(page.getByTestId("webpay-status")).toHaveText("Sin conectar");

  const form = page.getByRole("form", { name: "Conectar Webpay Plus" });
  await form.getByRole("button", { name: "Conectar Webpay Plus" }).click();
  await expect(form.getByText("El código de comercio tiene 12 dígitos.")).toBeVisible();
  await expect(form.getByText(/La llave secreta es más larga/)).toBeVisible();
  // La llave es un campo de contraseña: no queda a la vista ni se autocompleta.
  await expect(form.getByLabel("Llave secreta")).toHaveAttribute("type", "password");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/05-webpay-formulario-${project}.png`, fullPage: true });

  // Con una cuenta conectada (sembrada), se ve el estado sin revelar nada secreto.
  const key = process.env.AUTH_ENCRYPTION_KEY;
  test.skip(!key, "sin AUTH_ENCRYPTION_KEY en el entorno de la prueba");
  await prisma.paymentAccount.create({
    data: {
      organizationId: fixture.organizationId,
      provider: "WEBPAY_PLUS",
      providerUserId: "597055555532",
      accessTokenEncrypted: encryptSecret(SECRET, key!),
      refreshTokenEncrypted: encryptSecret("webpay-plus", key!),
      expiresAt: new Date("2999-01-01T00:00:00Z"),
      liveMode: false,
    },
  });
  await page.reload();
  await expect(page.getByTestId("webpay-status")).toHaveText("Conectada");
  await expect(page.getByText(/terminado en/)).toContainText("5532");
  await expect(page.getByText(/Ambiente de pruebas de Transbank/)).toBeVisible();
  expect(await page.content()).not.toContain(SECRET);
  expect(await page.content()).not.toContain("597055555532");
  await page.screenshot({ path: `${CAPTURES}/06-webpay-conectada-${project}.png`, fullPage: true });

  await page.getByTestId("disconnect-webpay").click();
  await page.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByTestId("webpay-status")).toHaveText("Sin conectar");
  expect(await prisma.paymentAccount.count({ where: { organizationId: fixture.organizationId, provider: "WEBPAY_PLUS" } })).toBe(0);
});
