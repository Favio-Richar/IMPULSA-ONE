import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";
import { registerUser } from "../register-user.js";

// F9.6b — el equipo de una agencia acotado por cliente y por módulo (ADR-028 §3), en teléfono y escritorio. El propietario limita a un
// administrador a UN cliente y a UNA sección; esa persona, con su propia sesión, ve solo eso y el servidor niega lo demás.

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
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id, kind: "BUSINESS" } });
  const api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  expect((await api.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/agency/enable`, { headers: CSRF })).status()).toBe(200);
  await api.dispose();
});

test.afterAll(async () => {
  await prisma.agencyMemberScope.deleteMany({ where: { agencyOrganizationId: fixture.organizationId } });
  await prisma.agencyClient.deleteMany({ where: { agencyOrganizationId: fixture.organizationId } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `eqag-pw-${suffix}` } } });
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

async function activateOrg(page: Page, organizationId: string): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, organizationId);
}

test("el propietario acota a un administrador a un cliente y una sección; esa persona solo ve eso", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const adminEmail = `eqag-admin-${project}-${suffix}@e2e.test`;
  createdEmails.push(adminEmail);

  // Preparación por la API: dos clientes de la agencia y un administrador en su equipo.
  const owner = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  const makeClient = async (label: string) => {
    const res = await owner.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/agency/clients`, {
      data: { name: `Cliente ${label} ${project}`, slug: `eqag-pw-${suffix}-${project}-${label}`, ownerEmail: `eqag-dueno-${label}-${project}-${suffix}@e2e.test` },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as { id: string; clientOrganizationId: string };
  };
  const adminApi = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
  await registerUser(adminApi, adminEmail, PASSWORD);
  await prisma.user.update({ where: { email: adminEmail }, data: { emailVerifiedAt: new Date() } });
  expect((await adminApi.post(`${API_BASE_URL}/auth/login`, { data: { email: adminEmail, password: PASSWORD } })).status()).toBe(201);
  const invite = await owner.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/members`, { data: { email: adminEmail, role: "ADMIN" } });
  expect(invite.status()).toBe(201);
  expect((await adminApi.post(`${API_BASE_URL}/memberships/${((await invite.json()) as { membershipId: string }).membershipId}/accept`)).status()).toBe(204);
  const one = await makeClient("uno");
  const two = await makeClient("dos");

  // 1. El propietario edita el acceso de esa persona desde la pantalla.
  await activateOrg(page, fixture.organizationId);
  await page.goto("/agencia/equipo");
  await expect(page.getByRole("heading", { name: "Equipo de la agencia", level: 1 })).toBeVisible();
  const row = page.locator(`[data-member-email="${adminEmail}"]`);
  await expect(row.getByTestId("agency-member-scope")).toHaveText("Todos los clientes · todos los módulos");
  const ownerRow = page.locator(`[data-member-email="${fixture.ownerEmail}"]`);
  await expect(ownerRow).toContainText("No se acota");
  await row.getByRole("button", { name: "Editar acceso" }).click();
  const editor = row.getByTestId("scope-editor");

  // Validación: sin clientes elegidos no se guarda.
  await editor.getByLabel(/Todos los clientes/).uncheck();
  await editor.getByRole("button", { name: "Guardar acceso" }).click();
  await expect(editor.getByTestId("scope-error")).toContainText("Elige al menos un cliente");
  await expectNoHorizontalScroll(page);
  await capture(page, `09-equipo-agencia-editor-${project}.png`);

  await editor.getByTestId("scope-clients").getByLabel(`Cliente uno ${project}`).check();
  await editor.getByLabel("Todas las secciones").uncheck();
  await editor.getByTestId("scope-modules").getByLabel("Medios").check();
  await editor.getByRole("button", { name: "Guardar acceso" }).click();
  await expect(row.getByTestId("agency-member-scope")).toHaveText(`1 cliente: Cliente uno ${project} · Medios`);
  await expectNoHorizontalScroll(page);
  await capture(page, `10-equipo-agencia-acotado-${project}.png`);

  // 2. La persona acotada, con su propia sesión: solo el cliente uno y solo Medios.
  const mine = await adminApi.get(`${API_BASE_URL}/organizations`);
  const orgs = (await mine.json()) as Array<{ id: string; access?: { modules: string[] } }>;
  expect(orgs.find((org) => org.id === one.clientOrganizationId)?.access?.modules).toEqual(["medios"]);
  expect(orgs.some((org) => org.id === two.clientOrganizationId)).toBe(false);
  expect((await adminApi.get(`${API_BASE_URL}/organizations/${two.clientOrganizationId}`)).status()).toBe(403);
  const denied = await adminApi.get(`${API_BASE_URL}/organizations/${one.clientOrganizationId}/contacts`);
  expect(denied.status()).toBe(403);
  expect(((await denied.json()) as { code: string }).code).toBe("AGENCY_MODULE_DENIED");

  const context = await browser.newContext({ ...use, storageState: await adminApi.storageState() });
  const adminPage = await context.newPage();
  try {
    await activateOrg(adminPage, one.clientOrganizationId);
    await adminPage.goto("/medios");
    await expect(adminPage.getByTestId("delegated-banner")).toBeVisible();
    // El menú solo ofrece lo permitido: Medios sí; Contactos y Sitios no. En el teléfono el menú está plegado: se abre.
    const menuButton = adminPage.getByRole("button", { name: /Abrir menú|Menú/i });
    if (await menuButton.isVisible()) await menuButton.click();
    const nav = adminPage.getByRole("navigation", { name: "Navegación principal" });
    await expect(nav.getByRole("link", { name: "Medios" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Contactos" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Sitios" })).toHaveCount(0);
    await expectNoHorizontalScroll(adminPage);
    await capture(adminPage, `11-equipo-agencia-vista-acotada-${project}.png`);

    // 3. La persona no puede cambiar su propio acceso: ve su fila sin botón.
    await activateOrg(adminPage, fixture.organizationId);
    await adminPage.goto("/agencia/equipo");
    const self = adminPage.locator(`[data-member-email="${adminEmail}"]`);
    await expect(self).toContainText("No puedes cambiar tu propio acceso");
    await expect(self.getByRole("button", { name: "Editar acceso" })).toHaveCount(0);
  } finally {
    await context.close();
  }

  // 4. Volver a «todo»: el estado por defecto no deja fila y la persona recupera el cliente dos.
  await page.reload();
  await row.getByRole("button", { name: "Editar acceso" }).click();
  await row.getByTestId("scope-editor").getByLabel(/Todos los clientes/).check();
  await row.getByTestId("scope-editor").getByLabel("Todas las secciones").check();
  await row.getByRole("button", { name: "Guardar acceso" }).click();
  await expect(row.getByTestId("agency-member-scope")).toHaveText("Todos los clientes · todos los módulos");
  expect((await adminApi.get(`${API_BASE_URL}/organizations/${two.clientOrganizationId}`)).status()).toBe(200);
  expect(await prisma.agencyMemberScope.count({ where: { agencyOrganizationId: fixture.organizationId } })).toBe(0);

  await owner.dispose();
  await adminApi.dispose();
});
