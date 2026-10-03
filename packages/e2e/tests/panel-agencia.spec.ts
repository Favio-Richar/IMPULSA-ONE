import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient, type AgencyClientStatus } from "@impulza/database";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// F9.4 — panel de agencia (ADR-028), en teléfono y escritorio: el resumen solo suma a los clientes activos, las alertas
// aparecen en su cliente, la tabla busca/filtra/ordena/pagina en el servidor y pausar a un cliente cambia las cifras al instante.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const CAPTURES = ".playwright/capturas/f94";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

let previousPlanId: string | null = null;

test.beforeAll(async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } });
  previousPlanId = org.planId;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id, kind: "BUSINESS" } });
  const api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  expect((await api.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/agency/enable`, { headers: CSRF })).status()).toBe(200);
  await api.dispose();
});

test.afterAll(async () => {
  await prisma.agencyClient.deleteMany({ where: { agencyOrganizationId: fixture.organizationId } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `pnl-e2e-${suffix}` } } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId, kind: "BUSINESS" } });
  await prisma.$disconnect();
});

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function capture(page: Page, file: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}`, fullPage: true });
  await page.emulateMedia({ reducedMotion: null });
}

async function openAgency(page: Page): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto("/agencia");
  await expect(page.getByRole("heading", { name: "Agencia", level: 1 })).toBeVisible();
}

const rows = (page: Page) => page.locator("[data-client-slug]");
const row = (page: Page, name: string) => page.locator("[data-client-slug]").filter({ hasText: name });

async function seedClient(name: string, status: AgencyClientStatus, project: string): Promise<{ id: string }> {
  const organization = await prisma.organization.create({ data: { name, slug: `pnl-e2e-${suffix}-${project}-${randomUUID().slice(0, 8)}` } });
  await prisma.agencyClient.create({ data: { agencyOrganizationId: fixture.organizationId, clientOrganizationId: organization.id, status, agencyCreated: true } });
  return organization;
}

test("sin clientes, el panel no muestra cifras vacías y guía a dar de alta el primero", async ({ page }, testInfo) => {
  await openAgency(page);
  await expect(page.getByText("Todavía no tienes clientes")).toBeVisible();
  await expect(page.getByTestId("agency-summary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Crear cliente" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `01-sin-clientes-${testInfo.project.name}.png`);
});

test("el resumen suma solo a los activos, marca las alertas y la tabla busca, filtra, ordena y pagina", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const today = new Date().toISOString().slice(0, 10);

  const aurora = await seedClient("Café Aurora", "ACTIVE", project);
  const boreal = await seedClient("Taller Boreal", "ACTIVE", project);
  const cobre = await seedClient("Estudio Cobre", "PAUSED", project);
  await seedClient("Panadería Delta", "ARCHIVED", project);
  for (let index = 1; index <= 8; index += 1) await seedClient(`Cliente Extra ${index}`, "ACTIVE", project);

  const site = await prisma.site.create({ data: { organizationId: aurora.id, name: "Sitio Aurora", slug: `pnl-e2e-${suffix}-${project}-s` } });
  await prisma.siteDomain.createMany({
    data: [
      { organizationId: aurora.id, siteId: site.id, domain: `mal-${suffix}-${project}.test`, type: "CUSTOM", verificationStatus: "FAILED", verificationToken: randomUUID() },
      { organizationId: aurora.id, siteId: site.id, domain: `espera-${suffix}-${project}.test`, type: "CUSTOM", verificationStatus: "PENDING", verificationToken: randomUUID() },
    ],
  });
  await prisma.analyticsAggregate.createMany({
    data: [
      { organizationId: aurora.id, siteId: site.id, period: today, metric: "page_view", value: 120 },
      { organizationId: aurora.id, siteId: site.id, period: today, metric: "block_click", value: 30 },
      { organizationId: aurora.id, siteId: site.id, period: today, metric: "whatsapp_click", value: 10 },
      { organizationId: boreal.id, period: today, metric: "page_view", value: 80 },
      { organizationId: boreal.id, period: today, metric: "block_click", value: 5 },
      // Pausado: mucha actividad que NO debe sumarse.
      { organizationId: cobre.id, period: today, metric: "page_view", value: 5000 },
    ],
  });
  for (let index = 0; index < 3; index += 1) await prisma.contact.create({ data: { organizationId: aurora.id, email: `c${index}-${suffix}-${project}@contactos.test` } });

  await openAgency(page);

  // Resumen: 10 activos de 12 relaciones; solo ellos suman.
  await expect(page.getByTestId("kpi-active")).toHaveText("10 de 12");
  await expect(page.getByTestId("kpi-page-views")).toHaveText("200");
  await expect(page.getByTestId("kpi-clicks")).toHaveText("45");
  await expect(page.getByTestId("kpi-contacts")).toHaveText("3");
  await expect(page.getByTestId("agency-alerts-summary")).toContainText("1 cliente con alertas");
  await expectNoHorizontalScroll(page);
  await capture(page, `02-panel-${project}.png`);

  // Paginación en el servidor: 12 clientes, 10 por página.
  await expect(page.getByTestId("agency-pagination-summary")).toHaveText("12 clientes · página 1 de 2");
  await expect(rows(page)).toHaveCount(10);
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByTestId("agency-pagination-summary")).toHaveText("12 clientes · página 2 de 2");
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  await capture(page, `03-pagina-2-${project}.png`);
  await page.getByRole("button", { name: "Anterior" }).click();
  await expect(rows(page)).toHaveCount(10);

  // Búsqueda: el cliente con alertas muestra sus métricas, plan, dominios y avisos.
  await page.getByLabel("Buscar cliente").fill("aurora");
  await expect(rows(page)).toHaveCount(1);
  const aurorRow = row(page, "Café Aurora");
  await expect(aurorRow.getByTestId("client-performance")).toContainText("120");
  await expect(aurorRow.getByTestId("client-plan")).toContainText("Sitios 1 de 1");
  await expect(aurorRow.getByTestId("client-alerts")).toContainText("falló la verificación");
  await expect(aurorRow.getByTestId("client-alerts")).toContainText("Cerca del límite del plan");
  await expect(aurorRow).toContainText("Dominios: 0 verificados, 1 sin verificar, 1 con error");
  await expectNoHorizontalScroll(page);
  await capture(page, `04-cliente-con-alertas-${project}.png`);

  // Un cliente pausado no se mide.
  await page.getByLabel("Buscar cliente").fill("");
  await page.getByLabel("Estado", { exact: true }).selectOption("PAUSED");
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, "Estudio Cobre")).toContainText("Solo se mide a los clientes activos.");
  await expect(row(page, "Estudio Cobre").getByTestId("client-performance")).toHaveCount(0);

  // Sin resultados → salida clara.
  await page.getByLabel("Estado", { exact: true }).selectOption("");
  await page.getByLabel("Buscar cliente").fill("zzzz-no-existe");
  await expect(page.getByText("Ningún cliente coincide")).toBeVisible();
  await capture(page, `05-sin-resultados-${project}.png`);
  await page.getByRole("button", { name: "Quitar filtros" }).click();
  await expect(rows(page)).toHaveCount(10);

  // Orden por nombre.
  await page.getByLabel("Ordenar por", { exact: true }).selectOption("name-asc");
  await expect(rows(page).first()).toContainText("Café Aurora");

  // Pausar a un cliente lo saca de las cifras al instante, y reanudarlo lo devuelve.
  await page.getByLabel("Buscar cliente").fill("boreal");
  await expect(rows(page)).toHaveCount(1);
  await row(page, "Taller Boreal").getByRole("button", { name: "Pausar" }).click();
  await page.getByRole("button", { name: "Confirmar pausa" }).click();
  await expect(row(page, "Taller Boreal").getByTestId("client-status")).toHaveText("En pausa (solo lectura)");
  await expect(page.getByTestId("kpi-active")).toHaveText("9 de 12");
  await expect(page.getByTestId("kpi-page-views")).toHaveText("120");
  await row(page, "Taller Boreal").getByRole("button", { name: "Reanudar" }).click();
  await expect(page.getByTestId("kpi-active")).toHaveText("10 de 12");
  await expect(page.getByTestId("kpi-page-views")).toHaveText("200");

  // El período se puede cambiar.
  await page.getByLabel("Período", { exact: true }).selectOption("7");
  await expect(page.getByTestId("kpi-page-views")).toHaveText("200");
  await expectNoHorizontalScroll(page);
});

test("si la API falla, el panel lo dice y deja reintentar", async ({ page }) => {
  await page.route("**/agency/overview**", (route) => route.fulfill({ status: 500, json: { message: "boom" } }));
  await openAgency(page);
  await expect(page.getByRole("button", { name: "Reintentar" }).first()).toBeVisible();
});
