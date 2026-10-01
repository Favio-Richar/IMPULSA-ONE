import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F7.6 (ADR-021) — embudos de conversión en el panel: crear el sugerido, leer el informe (pasos en
// orden, abandono, paso crítico, tabla equivalente), filtrar por dispositivo, editar con una página
// concreta, el aviso del límite de historial del plan y borrar. Teléfono y escritorio.
//
// Las visitas se siembran como "tablet" y el informe se filtra por ese dispositivo: los navegadores
// de prueba nunca son tablet, así que otras pruebas que visitan el sitio público no alteran la cuenta.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f76";
const prisma = new PrismaClient();

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Tres visitas de hoy: v1 vista → clic → contacto; v2 vista → clic; v3 solo vista. Esperado 3 → 2 → 1 → 0. */
async function seedVisits(prefix: string): Promise<void> {
  const now = Date.now() - 60 * 60 * 1000;
  const at = (seconds: number) => new Date(now + seconds * 1000);
  const rows = [
    { v: `${prefix}-1`, type: "page_view", t: at(0) },
    { v: `${prefix}-1`, type: "block_click", t: at(45) },
    { v: `${prefix}-1`, type: "lead_created", t: at(120) },
    { v: `${prefix}-2`, type: "page_view", t: at(0) },
    { v: `${prefix}-2`, type: "block_click", t: at(75) },
    { v: `${prefix}-3`, type: "page_view", t: at(10) },
  ];
  await prisma.analyticsEvent.createMany({
    data: rows.map((row) => ({
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      type: row.type,
      anonymizedVisitorId: row.v,
      device: "tablet",
      createdAt: row.t,
    })),
  });
}

async function cleanup(prefix: string): Promise<void> {
  await prisma.funnel.deleteMany({ where: { siteId: fixture.siteId } });
  await prisma.analyticsEvent.deleteMany({ where: { siteId: fixture.siteId, anonymizedVisitorId: { startsWith: prefix } } });
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("un embudo se crea desde el sugerido, muestra el abandono paso a paso, se edita y se borra", async ({ page }, testInfo) => {
  const prefix = `pw-f76-${testInfo.project.name}-${Date.now().toString(36)}`;
  await cleanup(prefix);
  await seedVisits(prefix);
  try {
    await page.goto("/analitica/embudos");
    await expect(page.getByRole("link", { name: "Embudos", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByLabel("Sitio").selectOption(fixture.siteId);

    // Vacío: explica qué es y ofrece el sugerido.
    await expect(page.getByRole("heading", { name: "Todavía no tienes embudos en este sitio" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/vacio-${testInfo.project.name}.png`, fullPage: true });
    await page.getByRole("button", { name: "Usar el embudo sugerido" }).click();

    const report = page.getByRole("region", { name: "Informe: Visita a pago" });
    await expect(report.getByRole("heading", { name: "Visita a pago" })).toBeVisible();
    await page.getByLabel("Dispositivo de entrada").selectOption("tablet");

    // 3 → 2 → 1 → 0, con el abandono entre pasos y el paso crítico destacado con texto.
    const steps = report.getByRole("list", { name: "Pasos del embudo" });
    await expect(steps.locator('[data-funnel-step="0"]')).toContainText("3");
    await expect(steps.locator('[data-funnel-step="1"]')).toContainText("2");
    await expect(steps.locator('[data-funnel-step="2"]')).toContainText("1");
    await expect(steps.locator('[data-funnel-step="3"]')).toContainText("0");
    await expect(steps.locator('[data-funnel-dropoff="1"]')).toContainText("1 abandona (33,3");
    await expect(steps.getByText("Mayor abandono")).toHaveCount(1);
    await expect(report.getByText("Entraron")).toBeVisible();

    // La tabla equivalente trae los mismos números.
    await report.getByText("Ver como tabla").click();
    const table = report.getByRole("table");
    await expect(table.getByRole("row", { name: /Interacción/ })).toContainText("2");
    await expect(table.getByRole("row", { name: /Interacción/ })).toContainText("1 min");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/informe-${testInfo.project.name}.png`, fullPage: true });

    // El historial del plan Gratis es de 30 días: 90 días ofrece cambiar de plan en vez de fallar.
    await page.getByRole("button", { name: "90 días" }).click();
    await expect(report.getByRole("link", { name: "Ver planes" })).toBeVisible();
    await page.getByRole("button", { name: "30 días" }).click();
    await expect(steps.locator('[data-funnel-step="0"]')).toContainText("3");

    // Editar: validación a la vista, un paso más sobre la página de inicio, reordenar y guardar.
    await report.getByRole("button", { name: "Editar" }).click();
    const dialog = page.getByRole("dialog", { name: /Editar/ });
    await dialog.getByLabel("Nombre del embudo").fill("");
    await dialog.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(dialog.getByText("Mínimo 2 caracteres.")).toBeVisible();
    await dialog.getByLabel("Nombre del embudo").fill("Del inicio al contacto");
    await dialog.getByRole("button", { name: "Agregar paso" }).click();
    await dialog.getByLabel("Nombre del paso 5").fill("Volvió al inicio");
    const fifth = dialog.getByRole("listitem").filter({ has: page.getByLabel("Nombre del paso 5") });
    await fifth.getByLabel("Vista de página").check();
    await fifth.getByLabel("Página (opcional)").selectOption({ label: "Inicio" });
    await dialog.getByRole("button", { name: "Subir el paso 5" }).click();
    await expect(dialog.getByLabel("Nombre del paso 4")).toHaveValue("Volvió al inicio");
    await page.screenshot({ path: `${CAPTURES}/editor-${testInfo.project.name}.png`, fullPage: true });
    await dialog.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(dialog).toBeHidden();

    const edited = page.getByRole("region", { name: "Informe: Del inicio al contacto" });
    await expect(edited.getByText("Volvió al inicio (Inicio)")).toBeVisible();
    await expect(edited.getByRole("list", { name: "Pasos del embudo" }).locator("[data-funnel-step]")).toHaveCount(5);

    // Borrar pide confirmación y vuelve al estado vacío.
    await edited.getByRole("button", { name: "Borrar" }).click();
    await edited.getByRole("button", { name: "Sí" }).click();
    await expect(page.getByRole("heading", { name: "Todavía no tienes embudos en este sitio" })).toBeVisible();
  } finally {
    await cleanup(prefix);
  }
});

test("el resumen de analítica enlaza a los embudos paso a paso", async ({ page }) => {
  await page.goto("/analitica");
  await expect(page.getByRole("link", { name: "Resumen", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Ver embudos paso a paso →" }).click();
  await expect(page).toHaveURL(/\/analitica\/embudos$/);
});
