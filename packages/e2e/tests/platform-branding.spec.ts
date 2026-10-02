import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_SESSION_PATH } from "../global-setup.js";
import { ADMIN_URL, DASHBOARD_URL } from "../playwright.config.js";

// F9.1 (ADR-028 §4) — Marca de la plataforma configurable desde superadministración.
// El dueño del sistema configura nombre, logotipos, colores, remitente y enlaces legales.
// Se valida contraste WCAG 2.2 AA (>= 4.5:1), vista previa reactiva en vivo,
// guardado, propagación al panel y sitio, y restablecimiento seguro con confirmación.
// Se prueba en móvil (Pixel 7) y escritorio (1440px) sin desborde horizontal.

test.use({ baseURL: ADMIN_URL, storageState: ADMIN_SESSION_PATH });

const CAPTURES = existsSync(path.resolve(process.cwd(), "docs/design/capturas/f91"))
  ? path.resolve(process.cwd(), "docs/design/capturas/f91")
  : path.resolve(process.cwd(), "../../docs/design/capturas/f91");

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe.configure({ mode: "serial" });

test("Marca de la plataforma (/marca): configuración, contraste AA, vista previa y restablecimiento", async ({ page }, testInfo) => {
  await page.goto("/marca");

  // 1. Título y encabezado principal
  await expect(page.getByRole("heading", { name: "Marca de la plataforma" })).toBeVisible();
  await expect(page.getByText("Configura la identidad global del producto")).toBeVisible();

  // 2. Comprobar que no hay desborde horizontal
  await expectNoHorizontalScroll(page);

  // 3. Captura inicial de la pantalla de marca
  await page.screenshot({
    path: path.join(CAPTURES, `01-marca-inicial-${testInfo.project.name}.png`),
    fullPage: false,
  });

  // 4. Validar contraste insuficiente: poner color con contraste < 4.5:1 sobre blanco
  const primaryInput = page.getByLabel("Color primario (acciones)");
  await primaryInput.fill("#ffff00"); // Amarillo sobre blanco: contraste pésimo (~1.07:1)
  await expect(page.getByText("Rechazado < 4.5:1")).toBeVisible();

  // El botón de guardar debe deshabilitarse cuando el contraste no pasa AA
  const submitButton = page.getByRole("button", { name: "Guardar cambios de marca" });
  await expect(submitButton).toBeDisabled();

  // 5. Configurar datos válidos
  await primaryInput.fill("#1e3a8a"); // Azul oscuro (contraste > 10:1 sobre blanco)
  await expect(page.getByText("Pasa AA").first()).toBeVisible();
  await expect(submitButton).toBeEnabled();

  const nameInput = page.getByLabel("Nombre de la plataforma");
  await nameInput.fill("Impulza Prime Global");

  const footerInput = page.getByLabel("Texto de pie de página (resumen)");
  await footerInput.fill("Plataforma global para creadores y empresas.");

  // 6. Verificar que la vista previa interactiva reacciona inmediatamente
  await expect(page.getByText("Impulza Prime Global").first()).toBeVisible();

  // Captura con datos editados y vista previa reactiva
  await page.screenshot({
    path: path.join(CAPTURES, `02-marca-editada-${testInfo.project.name}.png`),
    fullPage: false,
  });

  // 7. Guardar cambios
  await submitButton.click();
  await expect(page.getByText("Configuración de marca guardada y aplicada correctamente.")).toBeVisible();

  // 8. Verificar propagación al panel de control (apps/dashboard)
  const dashboardContext = await page.context().browser()!.newContext({
    baseURL: DASHBOARD_URL,
    storageState: "./.playwright/session.json",
  });
  const dashboardPage = await dashboardContext.newPage();
  await dashboardPage.goto("/");
  await expect(dashboardPage).toHaveTitle(/Impulza Prime Global/);
  if (testInfo.project.name === "escritorio") {
    await expect(dashboardPage.locator("aside").getByText("Impulza Prime Global").first()).toBeVisible();
  } else {
    await dashboardPage.getByRole("button", { name: "Abrir menú" }).click();
    await expect(dashboardPage.locator("aside").getByText("Impulza Prime Global").last()).toBeVisible();
  }

  await dashboardPage.screenshot({
    path: path.join(CAPTURES, `03-dashboard-marca-propagada-${testInfo.project.name}.png`),
    fullPage: false,
  });
  await dashboardContext.close();

  // 9. Volver a la pantalla de superadministración y probar el restablecimiento a los valores por defecto
  await page.bringToFront();
  const resetBtn = page.getByRole("button", { name: "Restablecer a la marca por defecto" });
  await resetBtn.click();

  // Pregunta de confirmación visible
  await expect(page.getByText("¿Restablecer todo a Impulza One?")).toBeVisible();
  const confirmBtn = page.getByRole("button", { name: "Confirmar restablecer" });
  await confirmBtn.click();

  // Confirmar resultado del reset
  await expect(page.getByText("Marca de la plataforma restablecida a los valores por defecto de Impulza One.")).toBeVisible();
  await expect(nameInput).toHaveValue("Impulza One");
  await expect(primaryInput).toHaveValue("#0f6f6b");

  // Captura final tras el restablecimiento
  await page.screenshot({
    path: path.join(CAPTURES, `04-marca-restablecida-${testInfo.project.name}.png`),
    fullPage: false,
  });
});
