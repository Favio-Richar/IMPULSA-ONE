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

test("editor de horario propio y bloqueos por profesional", async ({ page }, testInfo) => {
  const suffix = Date.now().toString(36);
  const staffName = `Dr. Horario ${suffix}`;

  await page.goto(`/sitios/${fixture.siteId}/reservas`);
  await expect(page.getByRole("heading", { name: "Reservas", level: 1 })).toBeVisible();

  // Crear profesional con horario inicial del sitio.
  const staffForm = page.getByRole("form", { name: "Agregar profesional" });
  await staffForm.getByLabel("Nombre y apellido").fill(staffName);
  await staffForm.getByLabel("Cargo o especialidad").fill("Especialista");
  await staffForm.getByRole("button", { name: "Agregar profesional" }).click();

  const staffRow = page.locator(`[data-staff="${staffName}"]`);
  await expect(staffRow).toBeVisible();
  await expect(staffRow).toContainText("Horario del sitio");

  // Abrir editor, activar horario propio y guardar.
  await staffRow.getByRole("button", { name: `Editar ${staffName}` }).click();
  const editForm = page.getByRole("form", { name: `Editar ${staffName}` });
  await expect(editForm).toBeVisible();
  await editForm.getByRole("button", { name: "Horario propio" }).click();
  await expect(editForm.getByRole("list", { name: "Horario semanal del profesional" })).toBeVisible();
  await editForm.getByRole("button", { name: "Guardar cambios" }).click();

  // La tarjeta del profesional ahora muestra el badge "Horario propio".
  await expect(staffRow).toBeVisible();
  await expect(staffRow).toContainText("Horario propio");

  // Bloqueo específico para este profesional.
  const blackoutForm = page.getByRole("form", { name: "Bloquear días" });
  await blackoutForm.getByLabel("Afecta a").selectOption({ label: staffName });
  await blackoutForm.getByLabel("Motivo (opcional)").fill(`Vacaciones ${suffix}`);
  await blackoutForm.getByRole("button", { name: "Bloquear" }).click();

  const blackoutList = page.getByRole("list", { name: "Días bloqueados" });
  const blackoutItem = blackoutList.locator("li", { hasText: staffName });
  await expect(blackoutItem).toBeVisible();
  await expect(blackoutItem).toContainText(`Vacaciones ${suffix}`);

  await expectNoHorizontalScroll(page);
  await staffRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${CAPTURES}/horario-bloqueo-${testInfo.project.name}.png`, fullPage: false });

  await page.setViewportSize({ width: 360, height: 800 });
  await expectNoHorizontalScroll(page);

  // Limpieza: quitar bloqueo y borrar profesional.
  await blackoutItem.getByRole("button", { name: "Quitar" }).click();
  await blackoutItem.getByRole("button", { name: "Sí" }).click();
  await expect(blackoutItem).toHaveCount(0);

  await staffRow.getByRole("button", { name: "Borrar" }).click();
  await staffRow.getByRole("button", { name: "Sí" }).click();
  await expect(staffRow).toHaveCount(0);
});

test("agenda con filtros por sucursal y por profesional", async ({ page }, testInfo) => {
  const suffix = Date.now().toString(36);
  const branchName = `Sucursal Filtro ${suffix}`;
  const staffName = `Dr. Filtro ${suffix}`;

  // Crear sucursal y profesional para que aparezcan en los filtros de la agenda.
  await page.goto(`/sitios/${fixture.siteId}/reservas`);
  const branchForm = page.getByRole("form", { name: "Agregar sucursal" });
  await branchForm.getByLabel("Nombre de la sucursal").fill(branchName);
  await branchForm.getByRole("button", { name: "Agregar sucursal" }).click();
  await expect(page.locator(`[data-branch="${branchName}"]`)).toBeVisible();

  const staffForm = page.getByRole("form", { name: "Agregar profesional" });
  await staffForm.getByLabel("Nombre y apellido").fill(staffName);
  await staffForm.getByLabel("Sucursal asignada").selectOption({ label: branchName });
  await staffForm.getByRole("button", { name: "Agregar profesional" }).click();
  await expect(page.locator(`[data-staff="${staffName}"]`)).toBeVisible();

  // Navegar a la agenda.
  await page.goto("/reservas");
  await expect(page.getByRole("heading", { name: "Reservas", level: 1 })).toBeVisible();

  // Verificar la presencia de los filtros y su interacción.
  const branchFilter = page.getByLabel("Filtrar por sucursal");
  const staffFilter = page.getByLabel("Filtrar por profesional");
  await expect(branchFilter).toBeVisible();
  await expect(staffFilter).toBeVisible();

  await branchFilter.selectOption({ label: branchName });
  await staffFilter.selectOption({ label: staffName });
  expect(await branchFilter.inputValue()).not.toBe("");
  expect(await staffFilter.inputValue()).not.toBe("");

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/agenda-filtros-${testInfo.project.name}.png`, fullPage: false });

  await page.setViewportSize({ width: 360, height: 800 });
  await expectNoHorizontalScroll(page);

  // Limpieza en /reservas: regresar y eliminar sucursal y profesional.
  await page.goto(`/sitios/${fixture.siteId}/reservas`);
  const staffRow = page.locator(`[data-staff="${staffName}"]`);
  await staffRow.getByRole("button", { name: "Borrar" }).click();
  await staffRow.getByRole("button", { name: "Sí" }).click();
  await expect(staffRow).toHaveCount(0);

  const branchRow = page.locator(`[data-branch="${branchName}"]`);
  await branchRow.getByRole("button", { name: "Borrar" }).click();
  await branchRow.getByRole("button", { name: "Sí" }).click();
  await expect(branchRow).toHaveCount(0);
});

