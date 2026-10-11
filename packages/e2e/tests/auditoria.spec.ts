import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";
import { registerUser } from "../register-user.js";

// F9.6d — auditoría navegable (ADR-028 §3), en teléfono y escritorio: filtros, paginación en el servidor, exportación CSV, quien no
// tiene permiso, y la vista de la agencia (solo lo que su equipo hizo en sus clientes).

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = ".playwright/capturas/f96";
const PASSWORD = "password1234";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const createdEmails: string[] = [];
let previousPlanId: string | null = null;

test.beforeAll(async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } });
  previousPlanId = org.planId;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id } });
});

test.afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, metadata: { path: ["pwMarker"], equals: suffix } } });
  await prisma.customRole.deleteMany({ where: { organizationId: fixture.organizationId, name: { startsWith: `Aud ${suffix}` } } });
  await prisma.agencyMemberScope.deleteMany({ where: { agencyOrganizationId: fixture.organizationId } });
  await prisma.agencyClient.deleteMany({ where: { agencyOrganizationId: fixture.organizationId } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `aud-pw-${suffix}` } } });
  await prisma.membership.deleteMany({ where: { organizationId: fixture.organizationId, user: { email: { in: createdEmails } } } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId, kind: "BUSINESS" } });
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
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

async function activateOrg(page: Page): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
}

test("filtra, pagina en el servidor y exporta; quien no es administrador no la ve", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const owner = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  const orgPath = `${API_BASE_URL}/organizations/${fixture.organizationId}`;

  // Actividad: tres roles creados por la API y 25 entradas de un grupo propio para poder paginar.
  for (const n of [1, 2, 3]) {
    const created = await owner.post(`${orgPath}/roles`, { data: { name: `Aud ${suffix} ${project} ${n}`, permissions: ["site.update"] } });
    expect(created.status()).toBe(201);
  }
  await prisma.auditLog.createMany({
    data: Array.from({ length: 25 }, (_, index) => ({
      organizationId: fixture.organizationId,
      action: "site.updated",
      targetType: "Site",
      targetId: fixture.siteId,
      metadata: { pwMarker: suffix, n: index },
    })),
  });

  await activateOrg(page);
  await page.goto("/configuracion/auditoria");
  await expect(page.getByRole("heading", { name: "Auditoría", level: 1 })).toBeVisible();
  const panel = page.getByTestId("audit-panel");
  await expect(panel.getByTestId("audit-row").first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `21-auditoria-lista-${project}.png`);

  // Paginación en el servidor: 20 por página y la siguiente trae el resto, sin repetir.
  await panel.getByLabel("Acción").selectOption({ label: "Sitios" });
  await panel.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(panel.getByTestId("audit-row")).toHaveCount(20);
  await expect(panel).toContainText(/1–20 de \d+/);
  await panel.getByRole("button", { name: "Siguiente" }).click();
  await expect(panel).toContainText(/21–\d+ de \d+/);
  await expect(panel.getByRole("button", { name: "Siguiente" })).toBeDisabled();

  // Filtro por grupo de acciones y por persona.
  await panel.getByLabel("Acción").selectOption({ label: "Roles personalizados" });
  await panel.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(panel.getByTestId("audit-row").first()).toHaveAttribute("data-action", "custom_role.created");
  await panel.getByLabel("Persona (correo)").fill("nadie-asi@");
  await panel.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(panel.getByText("Nada coincide con estos filtros")).toBeVisible();
  await capture(page, `22-auditoria-sin-resultados-${project}.png`);

  // Un rango inválido lo explica el servidor y se muestra, sin romper la pantalla.
  await panel.getByRole("button", { name: "Limpiar" }).click();
  await panel.getByLabel("Desde").fill("2026-10-10");
  await panel.getByLabel("Hasta").fill("2026-10-01");
  await panel.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(panel.getByRole("alert")).toContainText("rango debe ir de menor a mayor");

  // Exportar descarga un CSV con encabezado, respetando los filtros.
  await panel.getByRole("button", { name: "Limpiar" }).click();
  await panel.getByLabel("Acción").selectOption({ label: "Roles personalizados" });
  await panel.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(panel.getByTestId("audit-row").first()).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Exportar CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("auditoria.csv");
  const csv = readFileSync(await download.path(), "utf8");
  expect(csv.startsWith("﻿Fecha (UTC);Acción;Persona;Recurso;Id del recurso;Organización;Vía agencia;Detalle")).toBe(true);
  expect(csv).toContain("custom_role.created");
  expect(csv).not.toContain("site.updated");
  await expectNoHorizontalScroll(page);

  // Un editor (sin audit.view) no la ve: mensaje claro y el servidor responde 403.
  const email = `aud-editor-${project}-${suffix}@e2e.test`;
  createdEmails.push(email);
  const editorApi = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
  await registerUser(editorApi, email, PASSWORD);
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  expect((await editorApi.post(`${API_BASE_URL}/auth/login`, { data: { email, password: PASSWORD } })).status()).toBe(201);
  const invite = await owner.post(`${orgPath}/members`, { data: { email, role: "EDITOR" } });
  expect(invite.status()).toBe(201);
  expect((await editorApi.post(`${API_BASE_URL}/memberships/${((await invite.json()) as { membershipId: string }).membershipId}/accept`)).status()).toBe(204);
  expect((await editorApi.get(`${orgPath}/audit-logs`)).status()).toBe(403);
  const editorContext = await browser.newContext({ ...use, storageState: await editorApi.storageState() });
  const editorPage = await editorContext.newPage();
  try {
    await activateOrg(editorPage);
    await editorPage.goto("/configuracion/auditoria");
    await expect(editorPage.getByText("No tienes permiso para ver la auditoría")).toBeVisible();
    await expectNoHorizontalScroll(editorPage);
    await capture(editorPage, `23-auditoria-sin-permiso-${project}.png`);
  } finally {
    await editorContext.close();
    await editorApi.dispose();
    await owner.dispose();
  }
});

test("la agencia ve lo que su equipo hizo en un cliente, marcado y filtrable por cliente", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const owner = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  const orgPath = `${API_BASE_URL}/organizations/${fixture.organizationId}`;
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { kind: "BUSINESS" } });
  expect((await owner.post(`${orgPath}/agency/enable`)).status()).toBe(200);

  const clientName = `Cliente Aud ${project} ${suffix}`;
  const created = await owner.post(`${orgPath}/agency/clients`, {
    data: { name: clientName, slug: `aud-pw-${suffix}-${project}`, ownerEmail: `aud-dueno-${project}-${suffix}@e2e.test` },
  });
  expect(created.status()).toBe(201);
  const clientOrgId = ((await created.json()) as { clientOrganizationId: string }).clientOrganizationId;
  // La agencia actúa dentro del cliente (acceso delegado): queda marcada con su agencia.
  const site = await owner.post(`${API_BASE_URL}/organizations/${clientOrgId}/sites`, { data: { name: "Sitio del cliente", slug: `aud-pw-${suffix}-${project}-s` } });
  expect(site.status()).toBe(201);
  // Y el cliente hace algo por su cuenta: eso NO es de la agencia.
  await prisma.auditLog.create({ data: { organizationId: clientOrgId, action: "site.updated", targetType: "Site", metadata: { solo: "del-cliente", pwMarker: suffix } } });

  await activateOrg(page);
  await page.goto("/agencia/auditoria");
  await expect(page.getByRole("heading", { name: "Auditoría de la agencia", level: 1 })).toBeVisible();
  const panel = page.getByTestId("audit-panel");
  const rows = panel.getByTestId("audit-row");
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText("vía agencia");
  await expect(rows.first()).toContainText(clientName);
  await expect(panel).not.toContainText("del-cliente");
  await expectNoHorizontalScroll(page);
  await capture(page, `24-auditoria-agencia-${project}.png`);

  await panel.getByLabel("Cliente").selectOption({ label: clientName });
  await panel.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(rows.first()).toContainText(clientName);
  await owner.dispose();
});
