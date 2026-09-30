import { readFileSync } from "node:fs";
import { encryptSecret } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F5.8 — "Cobros": conectar, ver y desconectar la cuenta de Mercado Pago del negocio, en teléfono y
// escritorio. Este ambiente local no tiene la aplicación de Impulza en Mercado Pago: para el botón
// de conectar se simula solo la respuesta de disponibilidad y la URL de autorización (el flujo OAuth
// completo está probado en apps/api). La cuenta conectada se siembra y se desconecta con la API real.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f58";
const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.paymentAccount.deleteMany({ where: { organizationId: fixture.organizationId } });
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

test("sin la aplicación configurada, lo dice y ofrece seguir con enlaces de pago", async ({ page }) => {
  await prisma.paymentAccount.deleteMany({ where: { organizationId: fixture.organizationId } });
  await page.goto("/cobros");
  await expect(page.getByRole("heading", { name: "Cobros", level: 1 })).toBeVisible();
  await expect(page.getByTestId("account-status")).toHaveText("Sin conectar");
  await expect(page.getByText("todavía no está habilitada")).toBeVisible();
  await expect(page.getByTestId("connect-mercadopago")).toBeHidden();
  await expectNoHorizontalScroll(page);
});

test("conectar lleva a autorizar en Mercado Pago", async ({ page }, testInfo) => {
  await page.route("**/api/v1/organizations/*/payment-accounts", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), available: true } });
  });
  await page.route("**/api/v1/organizations/*/payment-accounts/mercadopago/connect", (route) =>
    route.fulfill({ status: 201, json: { url: "https://auth.mercadopago.com/authorization?client_id=1&state=abc&code_challenge=xyz&code_challenge_method=S256" } }),
  );
  await page.route("https://auth.mercadopago.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body><h1>Mercado Pago (simulado en la prueba)</h1></body></html>" }),
  );
  await page.goto("/cobros");
  await expect(page.getByText("Impulza One nunca ve tarjetas")).toBeVisible();
  await capture(page, `sin-conectar-${testInfo.project.name}.png`);
  await page.getByTestId("connect-mercadopago").click();
  await expect(page.getByRole("heading", { name: "Mercado Pago (simulado en la prueba)" })).toBeVisible();
});

test("al volver, cada resultado se explica; conectada se ve y se puede desconectar", async ({ page }, testInfo) => {
  await page.goto("/cobros?conexion=cancelada");
  await expect(page.getByTestId("connect-result")).toContainText("No se conectó la cuenta");
  await page.getByRole("button", { name: "Cerrar aviso" }).click();
  await expect(page).toHaveURL(/\/cobros$/);

  const key = process.env.AUTH_ENCRYPTION_KEY!;
  await prisma.paymentAccount.upsert({
    where: { organizationId_provider: { organizationId: fixture.organizationId, provider: "MERCADO_PAGO" } },
    create: {
      organizationId: fixture.organizationId,
      provider: "MERCADO_PAGO",
      providerUserId: "123",
      accessTokenEncrypted: encryptSecret("APP_USR-e2e", key),
      refreshTokenEncrypted: encryptSecret("TG-e2e", key),
      expiresAt: new Date(Date.now() + 150 * 24 * 3_600_000),
      liveMode: false,
    },
    update: {},
  });
  await page.goto("/cobros?conexion=conectada");
  await expect(page.getByTestId("connect-result")).toContainText("quedó conectada");
  await expect(page.getByTestId("account-status")).toHaveText("Conectada");
  await expect(page.getByText("Cuenta de prueba de Mercado Pago")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `conectada-${testInfo.project.name}.png`);

  await page.getByRole("button", { name: "Desconectar" }).click();
  await page.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByTestId("account-status")).toHaveText("Sin conectar");
  expect(await prisma.paymentAccount.count({ where: { organizationId: fixture.organizationId } })).toBe(0);
});
