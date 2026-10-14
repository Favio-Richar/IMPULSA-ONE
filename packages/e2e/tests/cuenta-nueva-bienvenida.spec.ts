import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test } from "@playwright/test";
import { registerUser } from "../register-user.js";

// Una cuenta recién creada (sin organización) entra directo al asistente al iniciar sesión, no a un panel vacío. Una cuenta con
// organización sigue entrando al panel.

const prisma = new PrismaClient();
const email = `nueva-${Date.now().toString(36)}@e2e.test`;
const PASSWORD = "password1234";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

test.afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

test("cuenta nueva sin organización: al iniciar sesión cae en el asistente de bienvenida", async ({ page }) => {
  const api = await apiRequest.newContext({ extraHTTPHeaders: { "X-Requested-With": "impulza-one" } });
  await registerUser(api, email, PASSWORD);
  await api.dispose();
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });

  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/bienvenida/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // «Cancelar y volver al panel» lleva al panel (no vuelve a rebotar al asistente).
  await page.getByRole("button", { name: "Cancelar y volver al panel" }).click();
  await page.getByRole("button", { name: "Sí, volver al panel" }).click();
  await expect(page).toHaveURL(/localhost:3100\/?$/);
  await expect(page.getByRole("link", { name: "Empezar con el asistente" })).toBeVisible({ timeout: 30_000 });
});
