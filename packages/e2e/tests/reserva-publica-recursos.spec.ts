import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F7.9a — reserva pública con selección de sucursal y profesional: selector en la página pública
// cuando hay 2 o más opciones, "Cualquiera disponible", asignación y confirmación detallada con
// profesional y sucursal asignados; sin desplazamiento horizontal en teléfono ni escritorio.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f79";
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const ALL_DAY = [{ start: "00:00", end: "24:00" }];

test.describe.configure({ mode: "serial" });

const suffix = Date.now().toString(36);
const branch1Name = `Sucursal Centro ${suffix}`;
const branch2Name = `Sucursal Oriente ${suffix}`;
const staff1Name = `Dra. Valentina ${suffix}`;
const staff2Name = `Dr. Mateo ${suffix}`;
const serviceName = `Terapia Recursos ${suffix}`;

let api: APIRequestContext;
let branch1Id: string;
let branch2Id: string;
let staff1Id: string;
let staff2Id: string;
let serviceId: string;
let blockId: string;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });

  // Limpiar cualquier residuo de pruebas previas
  try {
    const existingStaffRes = await api.get(`${site}/booking/staff`);
    if (existingStaffRes.ok()) {
      const existingStaff = (await existingStaffRes.json()) as Array<{ id: string; name: string }>;
      for (const s of existingStaff) {
        if (s.name.includes("Valentina") || s.name.includes("Mateo")) {
          await api.delete(`${site}/booking/staff/${s.id}`, { headers: CSRF });
        }
      }
    }
    const existingBranchesRes = await api.get(`${site}/booking/branches`);
    if (existingBranchesRes.ok()) {
      const existingBranches = (await existingBranchesRes.json()) as Array<{ id: string; name: string }>;
      for (const b of existingBranches) {
        if (b.name.includes("Centro") || b.name.includes("Oriente")) {
          await api.delete(`${site}/booking/branches/${b.id}`, { headers: CSRF });
        }
      }
    }
  } catch {
    // ignorar si no existen
  }

  // Configuración de reservas: habilitado y con disponibilidad completa.
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

  // Crear 2 sucursales
  const branch1Res = await api.post(`${site}/booking/branches`, {
    headers: CSRF,
    data: { name: branch1Name, address: "Calle Mayor 101, Santiago", active: true },
  });
  expect(branch1Res.status()).toBe(201);
  branch1Id = ((await branch1Res.json()) as { id: string }).id;

  const branch2Res = await api.post(`${site}/booking/branches`, {
    headers: CSRF,
    data: { name: branch2Name, address: "Av. Las Condes 5000, Santiago", active: true },
  });
  expect(branch2Res.status()).toBe(201);
  branch2Id = ((await branch2Res.json()) as { id: string }).id;

  // Crear 2 profesionales disponibles en el sitio
  const staff1Res = await api.post(`${site}/booking/staff`, {
    headers: CSRF,
    data: { name: staff1Name, title: "Kinesióloga", active: true },
  });
  expect(staff1Res.status()).toBe(201);
  staff1Id = ((await staff1Res.json()) as { id: string }).id;

  const staff2Res = await api.post(`${site}/booking/staff`, {
    headers: CSRF,
    data: { name: staff2Name, title: "Fisiatra", active: true },
  });
  expect(staff2Res.status()).toBe(201);
  staff2Id = ((await staff2Res.json()) as { id: string }).id;

  // Crear servicio asignado a ambos profesionales
  const serviceRes = await api.post(`${site}/booking/services`, {
    headers: CSRF,
    data: {
      name: serviceName,
      durationMinutes: 60,
      priceAmount: 20000,
      priceCurrency: "CLP",
      staffIds: [staff1Id, staff2Id],
    },
  });
  expect(serviceRes.status()).toBe(201);
  serviceId = ((await serviceRes.json()) as { id: string }).id;

  // Bloque de reserva en la página pública
  const blockRes = await api.post(blocksPath, {
    headers: CSRF,
    data: { type: "booking", config: { label: "Reservar con equipo e2e" } },
  });
  expect(blockRes.status()).toBe(201);
  blockId = ((await blockRes.json()) as { id: string }).id;

  // Publicar y revalidar la web pública
  expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
  const revalidated = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
    headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
    data: { siteSlug: fixture.siteSlug },
  });
  expect(revalidated.status()).toBe(200);
});

test.afterAll(async () => {
  // Limpieza de bloque, servicio, profesionales, sucursales y settings
  if (blockId) await api.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
  if (serviceId) await api.delete(`${site}/booking/services/${serviceId}`, { headers: CSRF });
  if (staff1Id) await api.delete(`${site}/booking/staff/${staff1Id}`, { headers: CSRF });
  if (staff2Id) await api.delete(`${site}/booking/staff/${staff2Id}`, { headers: CSRF });
  if (branch1Id) await api.delete(`${site}/booking/branches/${branch1Id}`, { headers: CSRF });
  if (branch2Id) await api.delete(`${site}/booking/branches/${branch2Id}`, { headers: CSRF });

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
  await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
    headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
    data: { siteSlug: fixture.siteSlug },
  });
  await api.dispose();
});

test("página pública con selector de sucursal, profesional y confirmación asignada", async ({ page }, testInfo) => {
  await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
  const summary = page.locator("summary", { hasText: "Reservar con equipo e2e" });
  await expect(summary).toBeVisible();
  await summary.click();

  // Paso 1: Seleccionar el servicio
  const serviceButton = page.getByRole("button", { name: new RegExp(serviceName) });
  await expect(serviceButton).toBeVisible();
  await serviceButton.click();

  // Paso 2: Preferencias de sucursal y profesional
  const branchFieldset = page.locator("fieldset", { hasText: "¿En qué sucursal prefieres atenderte?" });
  const staffFieldset = page.locator("fieldset", { hasText: "¿Con quién deseas atenderte?" });

  await expect(branchFieldset).toBeVisible();
  await expect(staffFieldset).toBeVisible();

  // Verificar opciones de sucursal
  await expect(branchFieldset.getByRole("button", { name: /Cualquiera/ })).toBeVisible();
  await expect(branchFieldset.getByRole("button", { name: new RegExp(branch1Name) })).toBeVisible();
  await expect(branchFieldset.getByRole("button", { name: new RegExp(branch2Name) })).toBeVisible();

  // Verificar opciones de profesional
  await expect(staffFieldset.getByRole("button", { name: /Cualquiera disponible/ })).toBeVisible();
  await expect(staffFieldset.getByRole("button", { name: new RegExp(staff1Name) })).toBeVisible();
  await expect(staffFieldset.getByRole("button", { name: new RegExp(staff2Name) })).toBeVisible();

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/publica-preferencias-${testInfo.project.name}.png`, fullPage: false });

  // Seleccionar sucursal y profesional específicos
  await branchFieldset.getByRole("button", { name: new RegExp(branch1Name) }).click();
  await staffFieldset.getByRole("button", { name: new RegExp(staff1Name) }).click();

  await page.getByRole("button", { name: "Continuar a fecha y hora" }).click();

  // Paso 3: Selección de horario
  const hours = page.getByRole("group", { name: "Hora" });
  await expect(hours.getByRole("button").first()).toBeVisible();

  // Avanzar a la semana siguiente para horas estables
  await page.getByRole("button", { name: "Semana siguiente" }).click();
  await expect(hours.getByRole("button").first()).toBeVisible();

  const slotIndex = testInfo.project.name === "movil" ? 1 : 2;
  await hours.getByRole("button").nth(slotIndex).click();

  // Paso 4: Formulario de datos
  await page.getByLabel("Nombre *").fill("Paciente Recursos");
  await page.getByLabel("Correo *").fill(`paciente-${Date.now().toString(36)}@e2e.test`);
  await page.getByText("Acepto que este negocio").click();

  await page.getByRole("button", { name: "Confirmar reserva" }).click();

  // Paso 5: Confirmación de reserva
  await expect(page.getByRole("heading", { name: "¡Reserva confirmada!" })).toBeVisible();
  const confirmationText = page.locator("[role='status']");
  await expect(confirmationText).toContainText(staff1Name);
  await expect(confirmationText).toContainText(branch1Name);

  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/publica-confirmada-${testInfo.project.name}.png`, fullPage: false });

  await page.setViewportSize({ width: 360, height: 800 });
  await expectNoHorizontalScroll(page);
});
