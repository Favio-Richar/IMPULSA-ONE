import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F7.9c — sincronización con calendarios desde el panel: el feed iCal (se sirve de verdad y su
// regeneración revoca el enlace anterior), el estado "modo desacoplado" de Google Calendar cuando el
// servidor no tiene credenciales, y la pantalla de retorno de Google con sus mensajes de error.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f79";

test.describe.configure({ mode: "serial" });

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("feed iCal: se sirve, se regenera y el enlace anterior deja de funcionar; Google en modo desacoplado", async ({ page }, testInfo) => {
  await page.goto(`/sitios/${fixture.siteId}/reservas`);
  await expect(page.getByRole("heading", { name: "Reservas", level: 1 })).toBeVisible();

  // El feed existe una vez guardada la configuración de reservas.
  await page.getByLabel("Recibir reservas en mi página").check();
  await page.getByRole("button", { name: "Guardar horario" }).click();
  await expect(page.getByText("Horario guardado.")).toBeVisible();

  const feedInput = page.getByLabel("URL del feed iCal de reservas");
  await expect(feedInput).toBeVisible();
  const firstUrl = await feedInput.inputValue();
  expect(firstUrl).toMatch(/\/api\/v1\/public\/bookings\/calendar-feed\/[0-9a-f]{48}\.ics$/);

  const served = await page.request.get(firstUrl);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toContain("text/calendar");
  expect(await served.text()).toContain("BEGIN:VCALENDAR");

  // Sin credenciales de Google en el servidor, la pantalla lo dice y ofrece el feed como alternativa.
  await expect(page.getByText("Modo desacoplado")).toBeVisible();
  await expect(page.getByRole("button", { name: /Conectar con Google Calendar/ })).toHaveCount(0);

  await expectNoHorizontalScroll(page);
  await page.getByRole("heading", { name: "Sincronización con calendarios" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${CAPTURES}/calendarios-${testInfo.project.name}.png`, fullPage: false });

  // Regenerar revoca el enlace anterior.
  await page.getByRole("button", { name: "Regenerar enlace" }).click();
  await page.getByRole("button", { name: "Sí" }).click();
  await expect(feedInput).not.toHaveValue(firstUrl);
  const secondUrl = await feedInput.inputValue();
  expect((await page.request.get(firstUrl)).status()).toBe(404);
  expect((await page.request.get(secondUrl)).status()).toBe(200);

  await page.setViewportSize({ width: 360, height: 800 });
  await expectNoHorizontalScroll(page);
});

test("retorno de Google Calendar: mensajes claros si se canceló o si la autorización venció", async ({ page }, testInfo) => {
  // El usuario canceló en la pantalla de Google.
  await page.goto("/integraciones/google-calendar?error=access_denied&state=cualquiera");
  await expect(page.getByText("No autorizaste el acceso a Google Calendar")).toBeVisible();

  // Llega un code con un state que este navegador nunca inició: no se llama a la API.
  await page.goto("/integraciones/google-calendar?code=abc&state=inventado");
  await expect(page.getByText("venció o no se inició desde el panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "Volver a Reservas" })).toBeVisible();

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/google-retorno-error-${testInfo.project.name}.png`, fullPage: false });
});
