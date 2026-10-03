import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";
import { registerUser } from "../register-user.js";

// F9.5b — traspaso de un cliente (ADR-028 §2), en teléfono y escritorio, con tres actores reales cada uno en su navegador: la agencia
// que traspasa, la agencia receptora y el propietario del negocio. Doble consentimiento: el propietario siempre, y la receptora si es
// otra agencia. Mientras está pendiente nada cambia.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = ".playwright/capturas/f95";
const PASSWORD = "password1234";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

let previousPlanId: string | null = null;
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
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `xfer-pw-${suffix}` } } });
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

interface Actor {
  email: string;
  api: APIRequestContext;
  context: BrowserContext;
  page: Page;
}

/** Una persona real con su cuenta y su propia ventana de navegador (sesión real, correo verificado en la base como global-setup). */
async function newActor(browser: Browser, project: BrowserContextOptions, label: string): Promise<Actor> {
  const email = `${label}-${suffix}@e2e.test`;
  createdEmails.push(email);
  const api = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
  await registerUser(api, email, PASSWORD);
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  expect((await api.post(`${API_BASE_URL}/auth/login`, { data: { email, password: PASSWORD } })).status()).toBe(201);
  const context = await browser.newContext({ ...project, storageState: await api.storageState() });
  return { email, api, context, page: await context.newPage() };
}

async function createOrg(actor: Actor, name: string, slug: string): Promise<string> {
  const created = await actor.api.post(`${API_BASE_URL}/organizations`, { data: { name, slug } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

test("el traspaso a otra agencia exige al propietario y a la agencia receptora; antes nada cambia", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const clientSlug = `xfer-pw-${suffix}-${project}-c`;
  const receiverSlug = `xfer-pw-${suffix}-${project}-b`;

  const owner = await newActor(browser, use, `traspaso-dueno-${project}`);
  const receiver = await newActor(browser, use, `traspaso-agencia-${project}`);
  try {
    const clientId = await createOrg(owner, "Negocio Traspasable", clientSlug);
    const receiverId = await createOrg(receiver, "Agencia Receptora", receiverSlug);
    await prisma.organization.update({ where: { id: receiverId }, data: { planId: (await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } })).id } });
    expect((await receiver.api.post(`${API_BASE_URL}/organizations/${receiverId}/agency/enable`)).status()).toBe(200);

    // Punto de partida: el negocio ya trabaja con la agencia A (el vínculo ya lo cubre agencia.spec).
    const sessionA = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
    expect((await sessionA.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/agency/clients/link`, { data: { clientSlug, ownerEmail: owner.email } })).status()).toBe(201);
    await sessionA.dispose();
    expect((await owner.api.post(`${API_BASE_URL}/organizations/${clientId}/agency-link/accept`)).status()).toBe(200);

    await activateOrg(page, fixture.organizationId);
    await activateOrg(owner.page, clientId);
    await activateOrg(receiver.page, receiverId);
    const rowOf = (target: Page) => target.locator(`[data-client-slug="${clientSlug}"]`);

    // 1. La agencia A propone traspasar a la agencia B.
    await page.goto("/agencia");
    await rowOf(page).getByRole("button", { name: "Traspasar este cliente" }).click();
    await page.getByLabel(/A otra agencia/).check();
    await page.getByLabel("Identificador de la agencia").fill(receiverSlug);
    await page.getByLabel("Correo del propietario de esa agencia").fill(receiver.email);
    await expectNoHorizontalScroll(page);
    await capture(page, `06-traspaso-agencia-propone-${project}.png`);
    await page.getByRole("button", { name: "Proponer traspaso" }).click();
    await expect(rowOf(page).getByTestId("client-transfer-pending")).toContainText("Traspaso en curso a «Agencia Receptora»");
    await expect(rowOf(page).getByTestId("client-transfer-pending")).toContainText("el propietario y la agencia receptora");
    // Nada cambia mientras tanto: la agencia A sigue pudiendo entrar y trabajar.
    await expect(rowOf(page).getByTestId("client-status")).toHaveText("En traspaso");
    await expect(rowOf(page).getByRole("button", { name: "Entrar" })).toBeVisible();

    // 2. El propietario ve la propuesta y acepta; sigue pendiente de la agencia receptora.
    await owner.page.goto("/configuracion/agencia");
    const proposal = owner.page.getByTestId("transfer-proposal");
    await expect(proposal).toContainText("a la agencia Agencia Receptora");
    await expect(proposal).toContainText("solo si ella también acepta");
    await expectNoHorizontalScroll(owner.page);
    await capture(owner.page, `07-traspaso-propietario-ve-${project}.png`);
    await proposal.getByRole("button", { name: "Aceptar el traspaso" }).click();
    await expect(owner.page.getByTestId("transfer-owner-accepted")).toBeVisible();
    // La agencia receptora todavía no tiene el negocio.
    await receiver.page.goto("/agencia");
    const offered = receiver.page.getByTestId("incoming-transfers");
    await expect(offered).toContainText("te ofrece el negocio «Negocio Traspasable»");
    await expect(offered).toContainText("el propietario ya aceptó");
    await expect(rowOf(receiver.page)).toHaveCount(0);
    await expectNoHorizontalScroll(receiver.page);
    await capture(receiver.page, `08-traspaso-agencia-receptora-ve-${project}.png`);

    // 3. La agencia receptora acepta: se completa y el negocio aparece en su lista.
    await offered.getByRole("button", { name: "Aceptar el cliente" }).click();
    await expect(receiver.page.getByTestId("incoming-transfers")).toHaveCount(0);
    await expect(rowOf(receiver.page).getByTestId("client-status")).toHaveText("Activo");
    await capture(receiver.page, `09-traspaso-completado-receptora-${project}.png`);

    // 4. La agencia A ya no lo tiene, y el propietario ve a su nueva agencia.
    await page.goto("/agencia");
    await expect(rowOf(page)).toHaveCount(0);
    await owner.page.goto("/configuracion/agencia");
    await expect(owner.page.getByTestId("agency-link-card")).toContainText("Agencia Receptora");
    await expect(owner.page.getByTestId("owner-transfer-card")).toHaveCount(0);
  } finally {
    await owner.context.close();
    await receiver.context.close();
    await owner.api.dispose();
    await receiver.api.dispose();
  }
});

test("el traspaso al propietario: él puede rechazarlo y, cuando lo acepta, la agencia pierde el acceso", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const clientSlug = `xfer-pw-${suffix}-${project}-d`;

  const owner = await newActor(browser, use, `traspaso-dueno2-${project}`);
  try {
    const clientId = await createOrg(owner, "Negocio Devuelto", clientSlug);
    const sessionA = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
    expect((await sessionA.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/agency/clients/link`, { data: { clientSlug, ownerEmail: owner.email } })).status()).toBe(201);
    await sessionA.dispose();
    expect((await owner.api.post(`${API_BASE_URL}/organizations/${clientId}/agency-link/accept`)).status()).toBe(200);

    await activateOrg(page, fixture.organizationId);
    await activateOrg(owner.page, clientId);
    const row = page.locator(`[data-client-slug="${clientSlug}"]`);

    const propose = async () => {
      await page.goto("/agencia");
      await row.getByRole("button", { name: "Traspasar este cliente" }).click();
      await page.getByRole("button", { name: "Proponer traspaso" }).click();
      await expect(row.getByTestId("client-transfer-pending")).toContainText("Traspaso en curso a su propietario");
    };

    // Propone y el propietario rechaza: la agencia sigue como estaba.
    await propose();
    await owner.page.goto("/configuracion/agencia");
    await expectNoHorizontalScroll(owner.page);
    await owner.page.getByTestId("transfer-proposal").getByRole("button", { name: "Rechazar" }).click();
    await expect(owner.page.getByTestId("owner-transfer-card")).toHaveCount(0);
    await page.goto("/agencia");
    await expect(row.getByTestId("client-status")).toHaveText("Activo");
    await expect(row.getByTestId("client-transfer-pending")).toHaveCount(0);

    // Propone de nuevo y el propietario acepta: la relación termina y la agencia pierde el acceso.
    await propose();
    await owner.page.goto("/configuracion/agencia");
    await owner.page.getByTestId("transfer-proposal").getByRole("button", { name: "Aceptar el traspaso" }).click();
    await expect(owner.page.getByText("Ninguna agencia tiene acceso a este negocio.")).toBeVisible();
    await capture(owner.page, `10-traspaso-al-propietario-completado-${project}.png`);
    await page.goto("/agencia");
    await expect(row).toHaveCount(0);
    // El negocio y su propietario siguen intactos.
    expect((await owner.api.get(`${API_BASE_URL}/organizations/${clientId}`)).status()).toBe(200);
  } finally {
    await owner.context.close();
    await owner.api.dispose();
  }
});
