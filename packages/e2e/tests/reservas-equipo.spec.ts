import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F7.9a — sucursales y profesionales de Reservas desde el panel: alta con validación, borrado, y
// sin desplazamiento horizontal ni en teléfono (también a 360 px) ni en escritorio. El horario
// propio por profesional (F7.9b) y la página pública con selector de profesional se prueban en la
// API (`booking-staff-branches.e2e.test.ts`); su prueba de interfaz sigue pendiente.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f79";

test.describe.configure({ mode: "serial" });

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("sucursales y profesionales: alta, validación y borrado", async ({ page }, testInfo) => {
  const suffix = Date.now().toString(36);
  const branchName = `Sucursal e2e ${suffix}`;
  const staffName = `Dra. e2e ${suffix}`;

  await page.goto(`/sitios/${fixture.siteId}/reservas`);
  await expect(page.getByRole("heading", { name: "Reservas", level: 1 })).toBeVisible();

  // Sucursal: el nombre es obligatorio (se avisa sin enviar) y luego se crea.
  const branchForm = page.getByRole("form", { name: "Agregar sucursal" });
  await branchForm.getByRole("button", { name: "Agregar sucursal" }).click();
  await expect(branchForm.getByRole("alert")).toBeVisible();
  await branchForm.getByLabel("Nombre de la sucursal").fill(branchName);
  await branchForm.getByLabel("Dirección").fill("Av. Providencia 1234, Santiago");
  await branchForm.getByRole("button", { name: "Agregar sucursal" }).click();
  const branchRow = page.locator(`[data-branch="${branchName}"]`);
  await expect(branchRow).toBeVisible();

  // Profesional asignado a esa sucursal, con horario propio.
  const staffForm = page.getByRole("form", { name: "Agregar profesional" });
  await staffForm.getByRole("button", { name: "Agregar profesional" }).click();
  await expect(staffForm.getByRole("alert")).toBeVisible();
  await staffForm.getByLabel("Nombre y apellido").fill(staffName);
  await staffForm.getByLabel("Cargo o especialidad").fill("Kinesióloga");
  await staffForm.getByLabel("Sucursal asignada").selectOption({ label: branchName });
  await staffForm.getByRole("button", { name: "Agregar profesional" }).click();
  const staffRow = page.locator(`[data-staff="${staffName}"]`);
  await expect(staffRow).toBeVisible();
  await expect(staffRow).toContainText(branchName);
  await expect(staffRow).toContainText("Horario del sitio");

  await expectNoHorizontalScroll(page);
  await staffRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${CAPTURES}/equipo-${testInfo.project.name}.png`, fullPage: false });

  await page.setViewportSize({ width: 360, height: 800 });
  await expectNoHorizontalScroll(page);

  // Limpieza: sin reservas vivas el borrado procede, y el sitio compartido queda como estaba.
  await staffRow.getByRole("button", { name: "Borrar" }).click();
  await staffRow.getByRole("button", { name: "Sí" }).click();
  await expect(staffRow).toHaveCount(0);
  await branchRow.getByRole("button", { name: "Borrar" }).click();
  await branchRow.getByRole("button", { name: "Sí" }).click();
  await expect(branchRow).toHaveCount(0);
});
