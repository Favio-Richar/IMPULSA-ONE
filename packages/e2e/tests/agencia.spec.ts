import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// F9.3 — agencia y acceso delegado (ADR-028 §2), en teléfono y escritorio: la agencia activa su modo, da de alta un
// cliente, entra a su negocio (aviso permanente), lo pausa (solo lectura, verificado contra la API) y lo reanuda; y un
// propietario real acepta la solicitud de la agencia y después la revoca. El servidor es quien decide: las pruebas de
// «pausa» y «revocado» consultan la API con la sesión de la agencia, no solo miran la pantalla.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = ".playwright/capturas/f93";
const PASSWORD = "password1234";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

let previousPlanId: string | null = null;
const createdSlugs: string[] = [];
const createdEmails: string[] = [];

test.beforeAll(async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } });
  previousPlanId = org.planId;
  // El plan «agencia» trae cupo de clientes (25); con el plan por defecto la API respondería 402 antes de llegar a lo que se prueba.
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id, kind: "BUSINESS" } });
});

test.afterAll(async () => {
  // Deja la organización sembrada como estaba y borra lo creado (las relaciones caen en cascada con las organizaciones).
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

/** La organización activa del panel vive en localStorage (zustand): se fija antes de cargar cada página. */
async function activateOrg(page: Page, organizationId: string): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, organizationId);
}

test("la agencia activa su modo, da de alta un cliente y entra a su negocio con el aviso permanente", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const slug = `e2e-ag-${project}-${suffix}`;
  createdSlugs.push(slug);
  await activateOrg(page, fixture.organizationId);

  await page.goto("/agencia");
  await expect(page.getByText("Esta organización no es una agencia")).toBeVisible();

  await page.goto("/configuracion/agencia");
  await expect(page.getByRole("heading", { name: "Agencia", level: 1 })).toBeVisible();
  await expect(page.getByText("Ninguna agencia tiene acceso a este negocio.")).toBeVisible();
  await page.getByRole("button", { name: "Activar modo agencia" }).click();
  await expect(page.getByText("Esta organización es una agencia.")).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("link", { name: "Administrar clientes" }).click();
  await expect(page).toHaveURL(/\/agencia$/);
  await expect(page.getByText("Todavía no tienes clientes")).toBeVisible();
  await expect(page.getByTestId("agency-quota")).toContainText(/Clientes:\s*0\s*de 25/);
  await capture(page, `01-agencia-vacia-${project}.png`);

  // Validación del formulario (el servidor valida igual: aquí solo se ve el mensaje).
  await page.getByLabel("Nombre del negocio", { exact: true }).fill("Cliente E2E");
  await page.getByLabel("Correo del propietario", { exact: true }).fill("no-es-un-correo");
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await expect(page.getByText("Escribe un correo válido.").first()).toBeVisible();

  const ownerEmail = `dueno-${project}-${suffix}@e2e.test`;
  await page.getByLabel("Identificador (interno)", { exact: true }).fill(slug);
  await page.getByLabel("Correo del propietario", { exact: true }).fill(ownerEmail);
  await page.getByRole("button", { name: "Crear cliente" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Creamos «Cliente E2E»" })).toBeVisible();

  const row = page.locator(`[data-client-slug="${slug}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("client-status")).toHaveText("Esperando al propietario");
  await expect(row).toContainText(`Invitación enviada a ${ownerEmail}`);
  await expect(page.getByTestId("agency-quota")).toContainText(/Clientes:\s*1\s*de 25/);
  await expectNoHorizontalScroll(page);
  await capture(page, `02-cliente-creado-${project}.png`);

  // Entrar: el negocio del cliente queda activo y el aviso lo dice de forma permanente.
  await row.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
  const banner = page.getByTestId("delegated-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Estás en el espacio de Cliente E2E como parte de");
  await expect(banner).toContainText("queda registrado a tu nombre y al de tu agencia");
  // El inicio de un cliente delegado no pide el equipo (el servidor se lo niega a la agencia): ni «Sin acceso» ni carga eterna.
  await expect(page.getByTestId("delegated-home")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cliente E2E", level: 1 })).toBeVisible();
  await expect(page.getByText("Sin acceso")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await capture(page, `03-dentro-del-cliente-${project}.png`);
});

test("un propietario real acepta; la agencia pausa y reanuda (solo lectura en el servidor); el propietario revoca", async ({ page, browser }, testInfo) => {
  const project = testInfo.project.name;
  const slug = `e2e-ag-propio-${project}-${suffix}`;
  const ownerEmail = `propio-${project}-${suffix}@e2e.test`;
  createdSlugs.push(slug);
  createdEmails.push(ownerEmail);

  // El propietario del negocio existente: cuenta real con sesión real (el correo se marca verificado en la base, como global-setup).
  const ownerApi = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
  expect((await ownerApi.post(`${API_BASE_URL}/auth/register`, { data: { email: ownerEmail, password: PASSWORD } })).status()).toBe(201);
  await prisma.user.update({ where: { email: ownerEmail }, data: { emailVerifiedAt: new Date() } });
  expect((await ownerApi.post(`${API_BASE_URL}/auth/login`, { data: { email: ownerEmail, password: PASSWORD } })).status()).toBe(201);
  const created = await ownerApi.post(`${API_BASE_URL}/organizations`, { data: { name: "Negocio con dueño", slug } });
  expect(created.status()).toBe(201);
  const clientId = ((await created.json()) as { id: string }).id;
  const ownerState = await ownerApi.storageState();
  await ownerApi.dispose();

  const ownerContext = await browser.newContext({ ...(testInfo.project.use as BrowserContextOptions), storageState: ownerState });
  const ownerPage = await ownerContext.newPage();
  await activateOrg(ownerPage, clientId);
  await activateOrg(page, fixture.organizationId);

  try {
    // 1. La agencia pide acceso a un negocio que ya existe: queda pendiente y sin acceso.
    await page.goto("/agencia");
    // Con clientes, el alta está plegada: se abre para pedir acceso a un negocio existente.
    await page.getByText("Dar de alta o vincular un cliente").click();
    await page.getByLabel("Identificador del negocio", { exact: true }).fill(slug);
    await page.getByLabel("Correo de su propietario", { exact: true }).fill(ownerEmail);
    await page.getByRole("button", { name: "Pedir acceso" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Quedó pendiente de su propietario" })).toBeVisible();
    const row = page.locator(`[data-client-slug="${slug}"]`);
    await expect(row.getByTestId("client-status")).toHaveText("Solicitud pendiente del propietario");
    await expect(row.getByRole("button", { name: "Entrar" })).toHaveCount(0);
    const before = await page.request.get(`${API_BASE_URL}/organizations/${clientId}/sites`);
    expect(before.status()).toBe(403);

    // 2. El propietario ve la solicitud y la acepta.
    await ownerPage.goto("/configuracion/agencia");
    await expect(ownerPage.getByTestId("agency-link-status")).toContainText("Pidió acceso a tu negocio. Hasta que aceptes, no puede ver nada.");
    await expectNoHorizontalScroll(ownerPage);
    await capture(ownerPage, `06-propietario-solicitud-${project}.png`);
    await ownerPage.getByRole("button", { name: "Aceptar" }).click();
    await expect(ownerPage.getByTestId("agency-link-status")).toContainText("Tiene acceso delegado");
    await capture(ownerPage, `07-propietario-acepto-${project}.png`);

    // 3. La agencia ya puede entrar.
    await page.goto("/agencia");
    await expect(row.getByTestId("client-status")).toHaveText("Activo");
    await expect(row.getByRole("button", { name: "Entrar" })).toBeVisible();
    expect((await page.request.get(`${API_BASE_URL}/organizations/${clientId}/sites`)).status()).toBe(200);

    // 4. Pausar: solo lectura, y el servidor lo aplica (no basta con ocultar botones).
    const sitesUrl = `${API_BASE_URL}/organizations/${clientId}/sites`;
    await row.getByRole("button", { name: "Pausar" }).click();
    await expect(page.getByRole("group", { name: "Confirmar pausa" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await capture(page, `04a-eleccion-de-pausa-${project}.png`);
    await page.getByLabel(/También ocultar su sitio público/).check();
    await page.getByRole("button", { name: "Confirmar pausa" }).click();
    await expect(row.getByTestId("client-status")).toHaveText("En pausa (solo lectura)");
    await expect(row.getByTestId("client-public-hidden")).toBeVisible();
    await capture(page, `04-cliente-en-pausa-${project}.png`);
    // El propietario lo ve en su panel: su sitio nunca se apaga sin que lo pueda saber.
    await ownerPage.reload();
    await expect(ownerPage.getByTestId("agency-hid-site")).toContainText("La agencia ocultó tu sitio público");
    await expectNoHorizontalScroll(ownerPage);
    await capture(ownerPage, `04b-propietario-ve-sitio-oculto-${project}.png`);
    expect((await page.request.get(sitesUrl)).status()).toBe(200);
    const blocked = await page.request.post(sitesUrl, { headers: CSRF, data: { name: "Sitio en pausa", slug: `e2e-pausa-${project}-${suffix}` } });
    expect(blocked.status()).toBe(403);
    await row.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByTestId("delegated-banner")).toContainText("Este cliente está en pausa: puedes ver, pero no hacer cambios.");
    await expectNoHorizontalScroll(page);
    await capture(page, `05-aviso-de-pausa-${project}.png`);

    // 5. Reanudar: vuelve a poder escribir.
    await page.goto("/agencia");
    await row.getByRole("button", { name: "Reanudar" }).click();
    await expect(row.getByTestId("client-status")).toHaveText("Activo");
    await expect(row.getByTestId("client-public-hidden")).toHaveCount(0);
    const allowed = await page.request.post(sitesUrl, { headers: CSRF, data: { name: "Sitio reanudado", slug: `e2e-reanuda-${project}-${suffix}` } });
    expect(allowed.status()).toBe(201);

    // 6. El propietario revoca: la agencia pierde el acceso al instante, también en el servidor.
    await ownerPage.getByRole("button", { name: "Revocar acceso de la agencia" }).click();
    await ownerPage.getByRole("button", { name: "Sí" }).click();
    await expect(ownerPage.getByText("Ninguna agencia tiene acceso a este negocio.")).toBeVisible();
    await capture(ownerPage, `08-propietario-reviso-${project}.png`);

    expect((await page.request.get(`${API_BASE_URL}/organizations/${clientId}/sites`)).status()).toBe(403);
    await page.goto("/agencia");
    await expect(page.locator(`[data-client-slug="${slug}"]`).getByRole("button", { name: "Entrar" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await capture(page, `09-agencia-sin-acceso-${project}.png`);
  } finally {
    await ownerContext.close();
  }
});
