import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F5.1 — configuración de reservas desde el panel: horario, servicio, día bloqueado y la vista
// previa de horarios calculada por el servidor; sin desplazamiento horizontal en teléfono (también
// a 360 px) ni en escritorio.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("configura horario y servicio, y la vista previa muestra horas libres", async ({ page }) => {
  const serviceName = `Corte e2e ${Date.now().toString(36)}`;
  await page.goto(`/sitios/${fixture.siteId}/reservas`);
  await expect(page.getByRole("heading", { name: "Reservas", level: 1 })).toBeVisible();

  // Abrir todos los días de 09:00 a 18:00 para que siempre haya horas en la próxima semana.
  await page.getByLabel("Recibir reservas en mi página").check();
  for (const day of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]) {
    const open = page.getByLabel(`${day} abierto`);
    if (!(await open.isChecked())) {
      await open.check();
    }
  }
  await page.getByLabel("Anticipación mínima").selectOption("0");
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado.")).toBeVisible();

  // Un tramo al revés se rechaza antes de enviar, con el día en el mensaje.
  await page.getByLabel("Lunes, tramo 1, desde").fill("19:00");
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Lunes:" })).toBeVisible();
  await page.getByLabel("Lunes, tramo 1, desde").fill("09:00");

  const form = page.getByRole("form", { name: "Agregar servicio" });
  await form.getByLabel("Nombre").fill(serviceName);
  await form.getByLabel("Duración").selectOption("45");
  await form.getByLabel("Precio (opcional)").fill("12.000");
  await form.getByRole("button", { name: "Agregar servicio" }).click();
  const row = page.locator(`[data-service="${serviceName}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("45 min");
  await expect(row).toContainText("$12.000");

  const preview = page.getByRole("list", { name: "Horarios libres por día" });
  await page.getByLabel("Servicio", { exact: true }).selectOption({ label: `${serviceName} · 45 min` });
  await expect(preview.locator("li[data-date]")).toHaveCount(7);
  await expect(preview.getByText("09:00").first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.setViewportSize({ width: 360, height: 800 });
  await expectNoHorizontalScroll(page);

  // Limpieza: el servicio no queda en el sitio compartido de las demás pruebas.
  await row.getByRole("button", { name: "Borrar" }).click();
  await row.getByRole("button", { name: "Sí" }).click();
  await expect(row).toHaveCount(0);
});
