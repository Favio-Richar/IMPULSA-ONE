import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F7.7 (ADR-022) — modo campaña en el panel: estado vacío, programar una campaña (con la UTM que se
// arma sola y la validación de fechas), comprobar en el sitio público (build de producción) que la
// página no se ve antes de su inicio, adelantarla para que esté activa y tome el inicio, el reporte
// con el enlace por fuente y el QR, el aviso de solape que manda la API, terminarla y borrarla.
// Teléfono y escritorio.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const CAPTURES = ".playwright/capturas/f77";
const prisma = new PrismaClient();

let api: APIRequestContext;
let pageId = "";
let pageSlug = "";

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function revalidate(): Promise<void> {
  const revalidated = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
    headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
    data: { siteSlug: fixture.siteSlug },
  });
  expect(revalidated.status()).toBe(200);
}

/** "YYYY-MM-DDTHH:mm" en la hora local del navegador de prueba (misma zona que este proceso). */
function localInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Página que la API pública manda servir en la raíz del sitio (`null` = el inicio de siempre). */
async function publicHomeSlug(): Promise<string | null | undefined> {
  const response = await api.get(`${API_BASE_URL}/public/sites/${fixture.siteSlug}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { homePageSlug?: string | null }).homePageSlug;
}

async function cleanupCampaigns(): Promise<void> {
  await prisma.pageCampaign.deleteMany({ where: { siteId: fixture.siteId } });
  await prisma.qrCode.deleteMany({ where: { organizationId: fixture.organizationId, directUrl: { contains: "utm_campaign=cyber-day-e2e" } } });
}

test.beforeAll(async () => {
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  await cleanupCampaigns();
  pageSlug = `cyber-${test.info().project.name}-${Date.now().toString(36)}`;
  const created = await api.post(`${site}/pages`, { headers: CSRF, data: { slug: pageSlug } });
  expect(created.status()).toBe(201);
  pageId = ((await created.json()) as { id: string }).id;
  expect((await api.post(`${site}/pages/${pageId}/publish`, { headers: CSRF })).status()).toBe(201);
});

test.afterAll(async () => {
  await cleanupCampaigns();
  if (pageId) {
    await api.delete(`${site}/pages/${pageId}`, { headers: CSRF });
  }
  await revalidate();
  await api.dispose();
  await prisma.$disconnect();
});

test("una campaña se programa, se activa tomando el inicio, se mide y se termina", async ({ page }, testInfo) => {
  const project = testInfo.project.name;

  // Acceso desde el detalle del sitio.
  await page.goto(`/sitios/${fixture.siteId}`);
  await page.getByRole("link", { name: "Ver campañas" }).click();
  await expect(page.getByRole("heading", { name: "Modo campaña", level: 1 })).toBeVisible();
  await expect(page.getByText("Todavía no hay campañas", { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/vacio-${project}.png`, fullPage: true });

  // Nueva: la UTM sigue al nombre; un fin antes del inicio se rechaza en el cliente.
  await page.getByRole("button", { name: "Nueva campaña" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva campaña" });
  await dialog.getByRole("textbox", { name: /^Nombre(\s*\*)?$/ }).fill("Cyber Day E2E");
  await expect(dialog.getByLabel("Nombre en Analytics (utm_campaign)")).toHaveValue("cyber-day-e2e");
  await dialog.getByLabel("Página de la campaña").selectOption({ label: `/${pageSlug}` });
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setSeconds(0, 0);
  await dialog.getByRole("textbox", { name: /^Empieza/ }).fill(localInput(tomorrow));
  await dialog.getByRole("textbox", { name: /^Termina/ }).fill(localInput(new Date(tomorrow.getTime() - 60 * 60 * 1000)));
  await dialog.getByRole("button", { name: "Programar campaña" }).click();
  await expect(dialog.getByText("El fin tiene que ser después del inicio.")).toBeVisible();
  await dialog.getByRole("textbox", { name: /^Termina/ }).fill(localInput(new Date(tomorrow.getTime() + 3 * 24 * 60 * 60 * 1000)));
  await page.screenshot({ path: `${CAPTURES}/editor-${project}.png`, fullPage: true });
  await dialog.getByRole("button", { name: "Programar campaña" }).click();
  await expect(dialog).toBeHidden();

  const scheduled = page.getByRole("region", { name: /Programadas/ });
  const card = page.getByRole("article", { name: "Cyber Day E2E" });
  await expect(scheduled.getByRole("article", { name: "Cyber Day E2E" })).toBeVisible();
  await expect(card).toContainText("Programada");
  await expect(card).toContainText(/Empieza en (23 h|24 h|1 días)/);

  // Público: antes del inicio la página no existe para nadie.
  await revalidate();
  expect((await api.get(`${PUBLIC_WEB_URL}/${fixture.siteSlug}/${pageSlug}`)).status()).toBe(404);

  // Editar: adelantar el inicio a hace una hora y tomar el inicio → pasa a "Activas".
  await card.getByRole("button", { name: "Editar" }).click();
  const edit = page.getByRole("dialog", { name: /Editar/ });
  await edit.getByRole("textbox", { name: /^Empieza/ }).fill(localInput(new Date(Date.now() - 60 * 60 * 1000)));
  await edit.getByLabel("Mostrarla como inicio mientras dure").check();
  await edit.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("region", { name: /Activas/ }).getByRole("article", { name: "Cyber Day E2E" })).toBeVisible();
  await expect(card).toContainText("Activa");
  await expect(card).toContainText("Toma el inicio");
  await expect(card).toContainText(/Termina en/);

  // Público: activa, la página responde; y la raíz del sitio la sirve en lugar del inicio.
  await revalidate();
  expect((await api.get(`${PUBLIC_WEB_URL}/${fixture.siteSlug}/${pageSlug}`)).status()).toBe(200);
  expect(await publicHomeSlug()).toBe(pageSlug);

  // Reporte: cifras, enlace por fuente y QR.
  await card.getByRole("button", { name: "Ver reporte" }).click();
  await expect(card.getByText("Visitas", { exact: true })).toBeVisible();
  await expect(card.getByText("Conversión", { exact: true })).toBeVisible();
  const link = card.locator("code");
  await expect(link).toContainText("utm_source=instagram");
  await expect(link).toContainText("utm_campaign=cyber-day-e2e");
  await card.getByLabel("Dónde lo compartes").selectOption("whatsapp");
  await expect(link).toContainText("utm_source=whatsapp");
  await card.getByRole("button", { name: "Crear QR de la campaña" }).click();
  await expect(card.getByRole("img", { name: /Código QR hacia/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/activa-reporte-${project}.png`, fullPage: true });

  // La API es la autoridad: otra campaña sobre la misma página en esas fechas se rechaza.
  await page.getByRole("button", { name: "Nueva campaña" }).click();
  const overlap = page.getByRole("dialog", { name: "Nueva campaña" });
  await overlap.getByRole("textbox", { name: /^Nombre(\s*\*)?$/ }).fill("Choque E2E");
  await overlap.getByLabel("Página de la campaña").selectOption({ label: `/${pageSlug}` });
  await overlap.getByRole("textbox", { name: /^Empieza/ }).fill(localInput(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  await overlap.getByRole("textbox", { name: /^Termina/ }).fill(localInput(new Date(Date.now() + 5 * 60 * 60 * 1000)));
  await overlap.getByRole("button", { name: "Programar campaña" }).click();
  await expect(overlap.getByText("Esa página ya está en otra campaña en esas fechas.")).toBeVisible();
  await overlap.getByRole("button", { name: "Cancelar" }).click();
  await expect(overlap).toBeHidden();

  // Terminar ahora (con confirmación en pantalla) y borrar.
  await card.getByRole("button", { name: "Terminar ahora" }).click();
  await card.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByRole("region", { name: /Terminadas o canceladas/ }).getByRole("article", { name: "Cyber Day E2E" })).toBeVisible();
  await expect(card).toContainText("Cancelada");
  await expect(card.getByRole("button", { name: "Editar" })).toHaveCount(0);
  await page.screenshot({ path: `${CAPTURES}/cancelada-${project}.png`, fullPage: true });

  // Cancelada, la página vuelve a ser una página normal del sitio (ADR-022 §3) y el inicio vuelve solo.
  await revalidate();
  expect((await api.get(`${PUBLIC_WEB_URL}/${fixture.siteSlug}/${pageSlug}`)).status()).toBe(200);
  expect(await publicHomeSlug()).toBeNull();

  await card.getByRole("button", { name: "Borrar" }).click();
  await card.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByText("Todavía no hay campañas", { exact: true })).toBeVisible();
});
