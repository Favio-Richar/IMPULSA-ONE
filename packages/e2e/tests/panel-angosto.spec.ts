import { expect, test } from "@playwright/test";
import { API_BASE_URL } from "../playwright.config.js";

// Cabecera del panel en un teléfono angosto (360 px, el más común de gama media). Con una
// organización de nombre largo, el selector empujaba "Cerrar sesión" fuera de la pantalla y toda la
// página se desplazaba de lado (56 px a 360, 26 a 390): el proyecto `movil` mide 412 y no lo veía.

const CSRF = { "X-Requested-With": "impulza-one" };

test("la cabecera del panel entra en 360 px aunque la organización tenga un nombre largo", async ({ page }) => {
  const created = await page.request.post(`${API_BASE_URL}/organizations`, {
    headers: CSRF,
    data: {
      name: "Organización con un nombre bastante largo para un teléfono",
      slug: `e2e-larga-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    },
  });
  expect(created.status()).toBe(201);

  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ["/sitios", "/enlaces"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    const logout = (await page.getByRole("button", { name: "Cerrar sesión" }).boundingBox())!;
    expect(logout.x + logout.width).toBeLessThanOrEqual(360);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
