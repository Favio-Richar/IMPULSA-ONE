import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// F5.3 — agenda del negocio: anotar una reserva desde el panel, verla en su día, marcarla como
// atendida y deshacerlo; sin desplazamiento horizontal en teléfono (también a 360 px) ni escritorio.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("anota una reserva, la marca como atendida y lo deshace", async ({ page }, testInfo) => {
  const service = await page.request.post(`${site}/booking/services`, { headers: CSRF, data: { name: `Agenda e2e ${testInfo.project.name}`, durationMinutes: 30 } });
  expect(service.status()).toBe(201);
  const serviceId = ((await service.json()) as { id: string }).id;
  const customer = `Cliente ${testInfo.project.name} ${Date.now().toString(36)}`;

  try {
    await page.goto("/reservas");
    await expect(page.getByRole("heading", { name: "Reservas", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Nueva reserva" }).click();

    const form = page.getByRole("form", { name: "Nueva reserva" });
    await form.getByLabel("Servicio").selectOption({ label: `Agenda e2e ${testInfo.project.name} · 30 min` });
    // Una hora distinta por proyecto: las dos corridas no se pisan en la misma agenda.
    await form.getByLabel("Hora").fill(testInfo.project.name === "movil" ? "07:00" : "07:30");
    await form.getByLabel("Nombre del cliente").fill(customer);
    await form.getByLabel("Correo").fill(`agenda-${Date.now().toString(36)}@e2e.test`);
    await form.getByRole("button", { name: "Guardar reserva" }).click();
    await expect(form).toHaveCount(0);

    const card = page.locator("[data-booking]", { hasText: customer });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Confirmada");
    await expectNoHorizontalScroll(page);

    await card.getByRole("button", { name: new RegExp(`^Atendida: ${customer}`) }).click();
    await expect(card).toContainText("Atendida");
    await card.getByRole("button", { name: new RegExp(`^Deshacer: ${customer}`) }).click();
    await expect(card).toContainText("Confirmada");

    await page.setViewportSize({ width: 360, height: 800 });
    await expectNoHorizontalScroll(page);
  } finally {
    await page.request.delete(`${site}/booking/services/${serviceId}`, { headers: CSRF });
  }
});
