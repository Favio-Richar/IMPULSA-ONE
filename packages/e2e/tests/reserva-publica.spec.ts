import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F5.2 — un visitante reserva desde la página pública: botón de la pila → servicio → día y hora →
// datos → confirmación con el enlace de pago del negocio y "Agregar a mi calendario". Todo contra
// la API real; sin desplazamiento horizontal en teléfono ni escritorio.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const ALL_DAY = [{ start: "00:00", end: "24:00" }];

let api: APIRequestContext;
let serviceId: string;
let blockId: string;

test.beforeAll(async () => {
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  // Todos los días, todo el día, sin anticipación: siempre hay horas que ofrecer.
  expect(
    (
      await api.put(`${site}/booking/settings`, {
        headers: CSRF,
        data: {
          enabled: true,
          timeZone: "America/Santiago",
          weeklyHours: { mon: ALL_DAY, tue: ALL_DAY, wed: ALL_DAY, thu: ALL_DAY, fri: ALL_DAY, sat: ALL_DAY, sun: ALL_DAY },
          minNoticeMinutes: 0,
          maxAdvanceDays: 60,
          bufferMinutes: 0,
          slotIntervalMinutes: 60,
        },
      })
    ).ok(),
  ).toBe(true);
  const service = await api.post(`${site}/booking/services`, {
    headers: CSRF,
    data: { name: "Sesión e2e", durationMinutes: 60, priceAmount: 15000, priceCurrency: "CLP", paymentUrl: "https://example.com/pago" },
  });
  expect(service.status()).toBe(201);
  serviceId = ((await service.json()) as { id: string }).id;
  const block = await api.post(blocksPath, { headers: CSRF, data: { type: "booking", config: { label: "Reservar hora e2e" } } });
  expect(block.status()).toBe(201);
  blockId = ((await block.json()) as { id: string }).id;
  expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
  const revalidated = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
    headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
    data: { siteSlug: fixture.siteSlug },
  });
  expect(revalidated.status()).toBe(200);
});

test.afterAll(async () => {
  await api.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
  await api.delete(`${site}/booking/services/${serviceId}`, { headers: CSRF });
  await api.put(`${site}/booking/settings`, {
    headers: CSRF,
    data: {
      enabled: false,
      timeZone: "America/Santiago",
      weeklyHours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      minNoticeMinutes: 120,
      maxAdvanceDays: 60,
      bufferMinutes: 0,
      slotIntervalMinutes: 30,
    },
  });
  await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
  await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, { headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET }, data: { siteSlug: fixture.siteSlug } });
  await api.dispose();
});

test("un visitante reserva desde la página y ve la confirmación con el pago del negocio", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
  const summary = page.locator("summary", { hasText: "Reservar hora e2e" });
  await expect(summary).toBeVisible();
  // Botón de la pila: a lo ancho y con el alto del resto.
  expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(56);
  await summary.click();

  await page.getByRole("button", { name: /Sesión e2e/ }).click();
  const hours = page.getByRole("group", { name: "Hora" });
  await expect(hours.getByRole("button").first()).toBeVisible();
  // La semana siguiente: días completos, sin depender de la hora en que corre la prueba.
  await page.getByRole("button", { name: "Semana siguiente" }).click();
  await expect(hours.getByRole("button").first()).toBeVisible();
  // Cada proyecto toma una hora distinta, así las dos corridas no compiten por la misma.
  const index = testInfo.project.name === "movil" ? 1 : 2;
  await hours.getByRole("button").nth(index).click();

  await page.getByLabel("Nombre *").fill("Visitante e2e");
  await page.getByLabel("Correo *").fill(`visitante-${Date.now().toString(36)}@e2e.test`);
  // Sin autorización no se envía.
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "autorización" })).toBeVisible();
  await page.getByText("Acepto que este negocio").click();
  await page.getByRole("button", { name: "Confirmar reserva" }).click();

  await expect(page.getByRole("heading", { name: "¡Reserva confirmada!" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pagar ahora" })).toHaveAttribute("href", "https://example.com/pago");
  await expect(page.getByRole("link", { name: "Agregar a mi calendario" })).toHaveAttribute("download", "reserva.ics");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
