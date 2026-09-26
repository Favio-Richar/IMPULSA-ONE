import { readFileSync } from "node:fs";
import { signBookingLinkToken } from "@impulza/auth";
import { expect, test } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_URL } from "../playwright.config.js";

// F5.4 — "Tu reserva": con el enlace firmado de su correo, el cliente ve su reserva y la cancela;
// un enlace falso da 404. La página no se indexa.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const secret = process.env.BOOKING_LINK_SECRET;

test.skip(!secret, "BOOKING_LINK_SECRET no configurado: sin enlace de gestión no hay página.");

test("con el enlace del correo, el cliente ve su reserva y la cancela", async ({ page }, testInfo) => {
  const service = await page.request.post(`${site}/booking/services`, { headers: CSRF, data: { name: `Gestión e2e ${testInfo.project.name}`, durationMinutes: 30 } });
  expect(service.status()).toBe(201);
  const serviceId = ((await service.json()) as { id: string }).id;
  // Una hora distinta por proyecto, lejos en el tiempo: siempre dentro del plazo para cambiarla.
  const startsAt = testInfo.project.name === "movil" ? "2031-06-02T13:00:00Z" : "2031-06-02T15:00:00Z";
  const booking = await page.request.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/bookings`, {
    headers: CSRF,
    data: { siteId: fixture.siteId, serviceId, startsAt, name: "Cliente Gestión", email: "gestion@e2e.test" },
  });
  expect(booking.status()).toBe(201);
  const bookingId = ((await booking.json()) as { id: string }).id;

  try {
    const response = await page.goto(`${PUBLIC_WEB_URL}/reserva/${signBookingLinkToken(bookingId, secret!)}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { name: "Tu reserva" })).toBeVisible();
    await expect(page.getByText(`Gestión e2e ${testInfo.project.name}`)).toBeVisible();
    await expect(page.getByText("Confirmada")).toBeVisible();

    await page.getByRole("button", { name: "Cancelar la reserva" }).click();
    await page.getByRole("button", { name: "Sí, cancelar" }).click();
    await expect(page.getByText("Tu reserva quedó cancelada")).toBeVisible();
    await expect(page.getByText("Cancelada", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cambiar la hora" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    const fake = await page.goto(`${PUBLIC_WEB_URL}/reserva/${bookingId}.firma-falsa`);
    expect(fake?.status()).toBe(404);
  } finally {
    await page.request.delete(`${site}/booking/services/${serviceId}`, { headers: CSRF });
  }
});
