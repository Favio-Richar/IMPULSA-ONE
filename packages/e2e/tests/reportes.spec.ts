import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F9.8a — informe por cliente (ADR-028 §6), en teléfono y escritorio: cifras conocidas, comparación con el periodo anterior, CSV sin
// fórmulas y vista imprimible sin la navegación.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/f98";
const prisma = new PrismaClient();
let previousPlanId: string | null = null;

function day(offset: number): string {
  return new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } });
  previousPlanId = org.planId;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id } });
  // Los datos del informe son de un periodo propio (hace 200 días) para no mezclarse con lo que dejen otras pruebas.
  const rows: Array<[string, string, number]> = [
    [day(-200), "page_view", 100],
    [day(-200), "page_view:visitors", 80],
    [day(-200), "lead_created", 8],
    [day(-207), "page_view", 50],
    [day(-207), "page_view:visitors", 40],
    [day(-207), "lead_created", 2],
  ];
  for (const [period, metric, value] of rows) {
    await prisma.analyticsAggregate.upsert({
      where: { organizationId_siteId_period_metric: { organizationId: fixture.organizationId, siteId: fixture.siteId, period, metric } },
      update: { value },
      create: { organizationId: fixture.organizationId, siteId: fixture.siteId, period, metric, value },
    });
  }
});

test.afterAll(async () => {
  await prisma.reportSchedule.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.analyticsAggregate.deleteMany({ where: { organizationId: fixture.organizationId, period: { in: [day(-200), day(-207)] }, siteId: fixture.siteId } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId } });
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

test("el informe muestra cifras conocidas con su comparación, se descarga en CSV y se imprime sin la navegación", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto("/reportes");
  await expect(page.getByRole("heading", { name: "Reportes", level: 1 })).toBeVisible();

  // Un periodo de 7 días que termina hace 200 días: la comparación contra los 7 días anteriores tiene datos.
  await page.getByLabel("Desde").fill(day(-206));
  await page.getByLabel("Hasta").fill(day(-200));
  await page.getByRole("button", { name: "Ver informe" }).click();
  const table = page.getByTestId("report-metrics");
  await expect(table).toBeVisible();
  const views = table.locator('[data-metric="pageViews"]');
  await expect(views).toContainText("100");
  await expect(views).toContainText("+100"); // +100 % contra 50
  await expect(views).toContainText("antes 50");
  await expect(table.locator('[data-metric="leads"]')).toContainText("+300"); // 8 contra 2
  // Conversión: 8 / 80 = 10 %.
  await expect(table.locator('[data-metric="conversion"]')).toContainText("10");
  await expectNoHorizontalScroll(page);
  await capture(page, `01-informe-${project}.png`);

  // CSV.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar CSV" }).click()]);
  expect(download.suggestedFilename()).toBe(`informe-${day(-206)}-${day(-200)}.csv`);
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv.startsWith("﻿Informe;")).toBe(true);
  expect(csv).toContain("Visitas;100;50;50;100.0 %");

  // Vista imprimible: la navegación y los controles no salen.
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("aside").first()).toBeHidden();
  await expect(page.getByRole("button", { name: "Descargar CSV" })).toBeHidden();
  await expect(table).toBeVisible();
  await page.emulateMedia({ media: "screen" });

  // Un periodo invertido lo explica el servidor.
  await page.getByLabel("Desde").fill(day(-1));
  await page.getByLabel("Hasta").fill(day(-5));
  await page.getByRole("button", { name: "Ver informe" }).click();
  await expect(page.getByText("Revisa las fechas")).toBeVisible();
});

test("un enlace compartido se abre sin sesión, muestra el informe sin datos personales y deja de servir al revocarlo", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto("/reportes");
  await page.getByLabel("Desde").fill(day(-206));
  await page.getByLabel("Hasta").fill(day(-200));
  await page.getByRole("button", { name: "Ver informe" }).click();
  await expect(page.getByTestId("report-metrics")).toBeVisible();

  // Crear el enlace: el token solo se muestra ahora.
  const panel = page.getByTestId("share-links");
  await panel.getByLabel("Nombre del enlace (opcional)").fill(`Cliente ${project}`);
  await panel.getByRole("button", { name: "Crear enlace" }).click();
  const created = page.getByTestId("share-link-created");
  await expect(created).toBeVisible();
  const url = await created.getByLabel("Enlace del informe").inputValue();
  expect(url).toMatch(/\/informe\/[A-Za-z0-9_-]{43}$/);
  await expectNoHorizontalScroll(page);
  await capture(page, `02-compartir-${project}.png`);

  // Se abre en un navegador SIN sesión: ve el informe fijado, con la marca, sin datos personales.
  const anonymous = await browser.newContext();
  const shared = await anonymous.newPage();
  try {
    await shared.goto(url);
    const report = shared.getByTestId("shared-report");
    await expect(report).toBeVisible();
    await expect(report.locator('[data-metric="pageViews"]')).toContainText("100");
    await expect(report.locator('[data-metric="pageViews"]')).toContainText("+100");
    await expect(report).not.toContainText("@");
    await expectNoHorizontalScroll(shared);
    await capture(shared, `03-informe-compartido-${project}.png`);
    // Sin indexar.
    await expect(shared.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    // El CSV sale del mismo enlace.
    const csv = await anonymous.request.get(`${url}/csv`);
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("Visitas;100;50");

    // Revocarlo desde el panel.
    const row = panel.getByTestId("share-link").first();
    await row.getByRole("button", { name: "Revocar" }).click();
    await row.getByRole("button", { name: "Sí" }).click();
    await expect(panel.getByTestId("share-link").first()).toHaveAttribute("data-active", "false");

    await shared.reload();
    await expect(shared.getByText("Este enlace ya no está disponible")).toBeVisible();
    expect((await anonymous.request.get(`${url}/csv`)).status()).toBe(410);
    await capture(shared, `04-informe-revocado-${project}.png`);
  } finally {
    await anonymous.close();
  }

  // Un enlace inventado: 404 de la plataforma, sin pistas.
  const probe = await apiRequest.newContext();
  const fake = new URL(url);
  fake.pathname = `/informe/${"A".repeat(43)}`;
  expect((await probe.get(fake.toString())).status()).toBe(404);
  await probe.dispose();
});

test("un informe programado se crea, se pausa, se reanuda, muestra su registro de envíos y se elimina", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  await prisma.reportSchedule.deleteMany({ where: { organizationId: fixture.organizationId } });
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto("/reportes");
  const panel = page.getByTestId("scheduled-reports");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Aún no programaste ningún informe.")).toBeVisible();

  // Validación del servidor: sin destinatarios no se programa.
  await panel.getByRole("button", { name: "Programar" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();

  await panel.getByLabel("Frecuencia").selectOption("MONTHLY");
  await panel.getByLabel("Destinatarios (máximo 5, separados por coma)").fill(`cliente-${project}@example.test, socio-${project}@example.test`);
  await panel.getByLabel("Nombre (opcional)").fill(`Mensual ${project}`);
  await panel.getByRole("button", { name: "Programar" }).click();

  const row = panel.getByTestId("report-schedule").first();
  await expect(row).toContainText(`Mensual ${project}`);
  await expect(row).toContainText(`cliente-${project}@example.test`);
  await expect(row).toContainText("Próximo envío");
  await expectNoHorizontalScroll(page);
  await capture(page, `05-programados-${project}.png`);

  await row.getByRole("button", { name: "Pausar" }).click();
  await expect(panel.getByTestId("report-schedule").first()).toHaveAttribute("data-enabled", "false");
  await expect(panel.getByTestId("report-schedule").first()).toContainText("En pausa");
  await panel.getByTestId("report-schedule").first().getByRole("button", { name: "Reanudar" }).click();
  await expect(panel.getByTestId("report-schedule").first()).toHaveAttribute("data-enabled", "true");

  // El registro de envíos viene del servidor: se siembra una ejecución enviada y otra fallida.
  const schedule = await prisma.reportSchedule.findFirstOrThrow({ where: { organizationId: fixture.organizationId } });
  await prisma.reportRun.createMany({
    data: [
      { scheduleId: schedule.id, organizationId: fixture.organizationId, periodFrom: "2026-08-01", periodTo: "2026-08-31", scheduledFor: new Date("2026-09-01T08:00:00Z"), status: "SENT", attempts: 1, deliveredTo: ["a@example.test", "b@example.test"], sentAt: new Date("2026-09-01T08:00:05Z") },
      { scheduleId: schedule.id, organizationId: fixture.organizationId, periodFrom: "2026-07-01", periodTo: "2026-07-31", scheduledFor: new Date("2026-08-01T08:00:00Z"), status: "FAILED", attempts: 3, errorCode: "SEND_FAILED" },
    ],
  });
  await page.reload();
  const runs = page.getByTestId("report-runs");
  await expect(runs.locator('[data-status="SENT"]')).toContainText("2 destinatarios");
  await expect(runs.locator('[data-status="FAILED"]')).toContainText("No se pudo enviar el correo.");
  await expectNoHorizontalScroll(page);
  await capture(page, `06-programados-registro-${project}.png`);

  // Eliminar pide confirmación.
  const target = page.getByTestId("report-schedule").first();
  await target.getByRole("button", { name: "Eliminar" }).click();
  await target.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByTestId("report-schedule")).toHaveCount(0);
  await expect(panel.getByText("Aún no programaste ningún informe.")).toBeVisible();
});

