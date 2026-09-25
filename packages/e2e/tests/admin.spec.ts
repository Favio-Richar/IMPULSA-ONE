import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_SESSION_PATH, FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { ADMIN_URL, DASHBOARD_URL } from "../playwright.config.js";

// F4.4 — superadministración (`apps/admin`). Con la sesión de administración sembrada en
// global-setup (otorgada con el script real y abierta con contraseña + código TOTP): el resumen,
// buscar y abrir una organización, bloquearla y ver el efecto en su panel, y el editor de planes.
// Mismas propiedades de layout que el resto: sin desplazamiento horizontal en teléfono ni escritorio.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;

test.use({ baseURL: ADMIN_URL, storageState: ADMIN_SESSION_PATH });

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("sin sesión de administración, cualquier pantalla lleva al ingreso", async ({ browser }) => {
  const context = await browser.newContext({ baseURL: ADMIN_URL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/organizaciones");
  await expect(page).toHaveURL(/\/ingresar$/);
  await expect(page.getByLabel("Código de verificación")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await context.close();
});

test("la sesión del panel no abre la administración", async ({ browser }) => {
  // La sesión del dueño de la organización sembrada, sin la cookie de administración.
  const context = await browser.newContext({ baseURL: ADMIN_URL, storageState: "./.playwright/session.json" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/ingresar$/);
  await context.close();
});

test("el resumen muestra totales, altas por día (con vista de tabla) y la distribución por plan", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
  await expect(page.getByText("Bloqueadas", { exact: true })).toBeVisible();
  await expect(page.getByText("Soporte pendiente")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Distribución por plan" })).toBeVisible();
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeAttached();

  const altas = page.getByRole("region", { name: "Altas recientes" });
  await altas.getByRole("button", { name: "Ver como tabla" }).click();
  // 30 días + encabezado.
  await expect(altas.getByRole("row")).toHaveCount(31);
  await expectNoHorizontalScroll(page);
});

test("busca una organización por el correo de su dueño y abre su detalle", async ({ page }) => {
  await page.goto("/organizaciones");
  await page.getByLabel("Buscar").fill(fixture.ownerEmail);
  const row = page.getByRole("link", { name: /Organización e2e/ });
  await expect(row).toHaveCount(1);
  await expectNoHorizontalScroll(page);

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/organizaciones/${fixture.organizationId}$`));
  await expect(page.getByRole("heading", { name: "Organización e2e" })).toBeVisible();
  await expect(page.getByRole("meter", { name: "Sitios" })).toBeVisible();
  await expect(page.getByRole("cell", { name: fixture.ownerEmail })).toBeVisible();
  // Ver el detalle quedó en su actividad, a nombre del superadministrador.
  await expect(page.getByRole("region", { name: "Actividad de administración" }).getByText(fixture.adminEmail).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("bloquear exige motivo, muestra el aviso en el panel del cliente y se puede restaurar", async ({ page, browser }) => {
  await page.goto(`/organizaciones/${fixture.organizationId}`);
  const blockSection = page.getByRole("region", { name: "Bloquear organización" });

  // Sin motivo no se envía.
  await blockSection.getByRole("button", { name: "Bloquear organización" }).click();
  await expect(blockSection.getByText("Explica el motivo")).toBeVisible();

  await blockSection.getByLabel("Motivo del bloqueo").fill("Prueba e2e de bloqueo");
  await blockSection.getByRole("button", { name: "Bloquear organización" }).click();

  try {
    await expect(page.getByText("Bloqueada", { exact: true })).toBeVisible();
    await expect(page.getByText("Motivo: Prueba e2e de bloqueo")).toBeVisible();

    // El dueño ve el aviso en su panel.
    const owner = await browser.newContext({ baseURL: DASHBOARD_URL, storageState: "./.playwright/session.json" });
    const ownerPage = await owner.newPage();
    await ownerPage.goto("/");
    await expect(ownerPage.getByRole("alert").filter({ hasText: "está bloqueada" })).toBeVisible();
    await expect(ownerPage.getByText("Motivo: Prueba e2e de bloqueo")).toBeVisible();
    await expectNoHorizontalScroll(ownerPage);
    await owner.close();
  } finally {
    // La organización sembrada la comparten todas las pruebas: se restaura pase lo que pase.
    const restoreSection = page.getByRole("region", { name: "Restaurar organización" });
    await restoreSection.getByLabel("Motivo de la restauración").fill("Fin de la prueba e2e");
    await restoreSection.getByRole("button", { name: "Restaurar organización" }).click();
    await expect(page.getByText("Activa", { exact: true })).toBeVisible();
  }
});

test("el editor de planes valida antes de enviar", async ({ page }) => {
  await page.goto("/planes");
  const gratis = page.getByRole("region", { name: "Gratis" });
  await expect(gratis.getByLabel("Sitios")).toBeVisible();

  await gratis.getByLabel("Precio mensual").fill("12,5");
  await gratis.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(gratis.getByText("Un número entero, sin puntos ni decimales.")).toBeVisible();
  await expect(gratis.getByText("Explica el motivo")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("usuarios y auditoría cargan sin desplazamiento horizontal", async ({ page }) => {
  await page.goto("/usuarios");
  await page.getByLabel("Buscar por correo").fill(fixture.adminEmail);
  // Encabezado + una fila: la búsqueda (con su espera anti-rebote) ya se aplicó.
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(page.getByRole("row", { name: new RegExp(fixture.adminEmail) }).getByText("Superadmin", { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto("/auditoria");
  await expect(page.getByRole("heading", { name: "Auditoría" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Vio el detalle de la organización" }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});
