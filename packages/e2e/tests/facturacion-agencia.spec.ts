import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { registerUser } from "../register-user.js";
import { API_BASE_URL } from "../playwright.config.js";

// F9.5a — quién paga el plan de un cliente (ADR-028 §2), en teléfono y escritorio, con un propietario real: la agencia propone,
// el propietario rechaza, la agencia propone otra vez, el propietario confirma, el negocio pasa a usar el plan de la agencia
// (se ve en su pantalla de plan) y después el propietario vuelve a pagar él.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = ".playwright/capturas/f95";
const PASSWORD = "password1234";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

let previousPlanId: string | null = null;
const createdSlugs: string[] = [];
const createdEmails: string[] = [];

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
  await prisma.organization.deleteMany({ where: { slug: { in: createdSlugs } } });
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

test("la agencia propone, el propietario rechaza, la agencia vuelve a proponer y el propietario confirma", async ({ page, browser }, testInfo) => {
  // El registro del propietario puede esperar al límite de registros por minuto (ver register-user.ts).
  test.setTimeout(150_000);
  const project = testInfo.project.name;
  const slug = `fact-e2e-${suffix}-${project}`;
  const ownerEmail = `fact-${project}-${suffix}@e2e.test`;
  createdSlugs.push(slug);
  createdEmails.push(ownerEmail);

  // Un propietario real con su negocio, que acepta a la agencia.
  const ownerApi = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
  await registerUser(ownerApi, ownerEmail, PASSWORD);
  await prisma.user.update({ where: { email: ownerEmail }, data: { emailVerifiedAt: new Date() } });
  expect((await ownerApi.post(`${API_BASE_URL}/auth/login`, { data: { email: ownerEmail, password: PASSWORD } })).status()).toBe(201);
  const created = await ownerApi.post(`${API_BASE_URL}/organizations`, { data: { name: "Negocio Facturación", slug } });
  expect(created.status()).toBe(201);
  const clientId = ((await created.json()) as { id: string }).id;
  const ownerState = await ownerApi.storageState();
  await ownerApi.dispose();

  const ownerContext = await browser.newContext({ ...(testInfo.project.use as BrowserContextOptions), storageState: ownerState });
  const ownerPage = await ownerContext.newPage();
  await activateOrg(ownerPage, clientId);
  await activateOrg(page, fixture.organizationId);

  try {
    // La agencia pide acceso y el propietario acepta (el flujo ya lo cubre agencia.spec; acá es solo el punto de partida).
    await page.goto("/agencia");
    // Sin clientes el bloque viene abierto y con clientes, plegado: se abre solo si hace falta.
    const addSection = page.locator("details").filter({ hasText: "Dar de alta o vincular un cliente" });
    if (!(await addSection.evaluate((element) => (element as HTMLDetailsElement).open))) await addSection.locator("summary").click();
    await page.getByLabel("Identificador del negocio", { exact: true }).fill(slug);
    await page.getByLabel("Correo de su propietario", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Pedir acceso" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Quedó pendiente de su propietario" })).toBeVisible();
    await ownerPage.goto("/configuracion/agencia");
    await ownerPage.getByRole("button", { name: "Aceptar" }).click();
    await expect(ownerPage.getByTestId("agency-link-status")).toContainText("Tiene acceso delegado");

    const row = page.locator(`[data-client-slug="${slug}"]`);
    await page.goto("/agencia");
    await expect(row.getByTestId("client-billing-mode")).toHaveText("Paga el cliente");

    // 1. La agencia propone que pague la agencia.
    await row.getByRole("button", { name: "Cambiar quién paga" }).click();
    await expect(page.getByRole("group", { name: "Cambiar quién paga" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await capture(page, `01-agencia-propone-${project}.png`);
    await page.getByRole("button", { name: "Proponer: paga la agencia" }).click();
    await expect(row.getByTestId("client-billing-pending")).toContainText("esperando al propietario");
    await expect(row.getByTestId("client-billing-mode")).toHaveText("Paga el cliente");
    await expect(page.getByTestId("agency-billing-summary")).toContainText("1 propuesta esperando al propietario");

    // 2. El propietario la ve y la rechaza: nada cambia.
    await ownerPage.goto("/configuracion/agencia");
    const proposal = ownerPage.getByTestId("billing-proposal");
    await expect(proposal).toContainText("Nada cambia hasta que lo confirmes");
    await expectNoHorizontalScroll(ownerPage);
    await capture(ownerPage, `02-propietario-ve-propuesta-${project}.png`);
    await proposal.getByRole("button", { name: "Rechazar" }).click();
    await expect(ownerPage.getByTestId("billing-proposal")).toHaveCount(0);
    await expect(ownerPage.getByTestId("owner-billing-mode")).toHaveText("Hoy pagas tú el plan de tu negocio.");

    // 3. La agencia vuelve a proponer y esta vez el propietario confirma.
    await page.goto("/agencia");
    await row.getByRole("button", { name: "Cambiar quién paga" }).click();
    await page.getByRole("button", { name: "Proponer: paga la agencia" }).click();
    await expect(row.getByTestId("client-billing-pending")).toBeVisible();
    await ownerPage.reload();
    await ownerPage.getByTestId("billing-proposal").getByRole("button", { name: "Confirmar el cambio" }).click();
    await expect(ownerPage.getByTestId("owner-billing-mode")).toContainText("Hoy paga");
    await expect(ownerPage.getByTestId("billing-proposal")).toHaveCount(0);
    await capture(ownerPage, `03-propietario-confirmo-${project}.png`);

    // 4. El negocio usa el plan de la agencia: se ve en su pantalla de plan.
    await ownerPage.goto("/plan");
    await expect(ownerPage.getByText("Plan de tu agencia: ella paga y tu negocio usa sus límites")).toBeVisible();
    await expectNoHorizontalScroll(ownerPage);
    await capture(ownerPage, `04-plan-del-negocio-${project}.png`);

    // 5. La agencia ve el cambio y el historial.
    await page.goto("/agencia");
    await expect(row.getByTestId("client-billing-mode")).toHaveText("Paga la agencia");
    await expect(row.getByTestId("client-billing-pending")).toHaveCount(0);
    await expect(page.getByTestId("agency-billing-summary")).toContainText("pagas tú el plan de 1 cliente");
    await row.getByRole("button", { name: "Ver historial" }).click();
    const history = row.getByTestId("billing-history");
    await expect(history.locator("li")).toHaveCount(2);
    await expect(history.locator("li").first()).toContainText("Confirmado");
    await expect(history.locator("li").nth(1)).toContainText("Rechazado");
    await expectNoHorizontalScroll(page);
    await capture(page, `05-agencia-historial-${project}.png`);

    // 6. El propietario vuelve a pagar él: al instante, y su plan vuelve a ser el suyo.
    await ownerPage.goto("/configuracion/agencia");
    await ownerPage.getByRole("button", { name: "Volver a pagar yo" }).click();
    await ownerPage.getByRole("button", { name: "Sí" }).click();
    await expect(ownerPage.getByTestId("owner-billing-mode")).toHaveText("Hoy pagas tú el plan de tu negocio.");
    await ownerPage.goto("/plan");
    await expect(ownerPage.getByText("Plan inicial")).toBeVisible();
  } finally {
    await ownerContext.close();
  }
});
