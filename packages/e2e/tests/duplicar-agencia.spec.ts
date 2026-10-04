import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";
import { registerUser } from "../register-user.js";

// F9.5c — duplicar un cliente (ADR-028 §2), en teléfono y escritorio: la agencia crea un cliente NUEVO con el sitio de otro, en
// borrador, y la pantalla le dice con claridad qué se copió, qué hay que revisar y qué nunca se copia. En la base se comprueba que
// no viajó ningún dato personal ni de cobro.

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
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `dup-pw-${suffix}` } } });
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

test("la agencia duplica un cliente: el informe dice qué se copió y qué no, y en la base no viaja ningún dato sensible", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const sourceSlug = `dup-pw-${suffix}-${project}-o`;
  const copySlug = `dup-pw-${suffix}-${project}-c`;
  const sourceOwnerEmail = `dup-origen-${project}-${suffix}@e2e.test`;
  const copyOwnerEmail = `dup-copia-${project}-${suffix}@e2e.test`;
  createdEmails.push(sourceOwnerEmail);

  // El cliente origen: un negocio real con su propietario, ya vinculado a la agencia.
  const owner = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
  await registerUser(owner, sourceOwnerEmail, PASSWORD);
  await prisma.user.update({ where: { email: sourceOwnerEmail }, data: { emailVerifiedAt: new Date() } });
  expect((await owner.post(`${API_BASE_URL}/auth/login`, { data: { email: sourceOwnerEmail, password: PASSWORD } })).status()).toBe(201);
  const created = await owner.post(`${API_BASE_URL}/organizations`, { data: { name: "Negocio Origen Duplicable", slug: sourceSlug } });
  expect(created.status()).toBe(201);
  const sourceId = ((await created.json()) as { id: string }).id;
  const agencyApi = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  expect((await agencyApi.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/agency/clients/link`, { data: { clientSlug: sourceSlug, ownerEmail: sourceOwnerEmail } })).status()).toBe(201);
  await agencyApi.dispose();
  expect((await owner.post(`${API_BASE_URL}/organizations/${sourceId}/agency-link/accept`)).status()).toBe(200);
  await owner.dispose();

  // Su contenido (se copia o se limpia) y sus datos sensibles (no se copian jamás).
  const asset = randomUUID();
  const site = await prisma.site.create({ data: { organizationId: sourceId, name: "Sitio Origen", slug: `${sourceSlug}-s`, ga4MeasurementId: "G-ORIGENPW1" } });
  const home = await prisma.page.create({ data: { siteId: site.id, slug: "inicio", position: 0, isHome: true } });
  const addBlock = async (type: string, position: number, config: object) => {
    const block = await prisma.block.create({ data: { pageId: home.id, type, position } });
    await prisma.blockVersion.create({ data: { blockId: block.id, versionNumber: 1, config } });
  };
  await addBlock("hero", 0, { title: "Bienvenidos", alignment: "center", background: { url: `https://cdn.ejemplo.test/org/${sourceId}/${asset}/w1600.webp`, alt: "Local" } });
  await addBlock("whatsapp", 1, { phone: "+56912345678", label: "Escríbenos por WhatsApp" });
  await prisma.contact.create({ data: { organizationId: sourceId, name: "Persona Real", email: "persona.real@clientes.test" } });
  await prisma.paymentAccount.create({ data: { organizationId: sourceId, provider: "MERCADO_PAGO", providerUserId: "777", accessTokenEncrypted: "cifrado", refreshTokenEncrypted: "cifrado", expiresAt: new Date(Date.now() + 86_400_000), liveMode: false } });

  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto("/agencia");
  const sourceRow = page.locator(`[data-client-slug="${sourceSlug}"]`);
  await expect(sourceRow).toBeVisible();

  // 1. Abre el panel de duplicación: avisa de lo que no se copia antes de crear nada.
  await sourceRow.getByRole("button", { name: "Duplicar en un cliente nuevo" }).click();
  const panel = page.getByRole("group", { name: "Duplicar en un cliente nuevo" });
  await expect(panel).toContainText("No se copian contactos, respuestas, pedidos, reservas, pagos, claves ni cuentas de cobro");
  await panel.getByLabel("Nombre del cliente nuevo").fill("Copia Playwright");
  // El identificador se propone solo desde el nombre; aquí se fija uno único.
  await panel.getByLabel("Identificador del cliente nuevo").fill(copySlug);
  await panel.getByLabel("Correo de su propietario").fill(copyOwnerEmail);
  await expectNoHorizontalScroll(page);
  await capture(page, `11-duplicar-formulario-${project}.png`);

  // 2. Lo crea: el informe es claro sobre lo copiado, lo que hay que revisar y lo omitido.
  await panel.getByRole("button", { name: "Crear el cliente duplicado" }).click();
  const report = sourceRow.getByTestId("duplicate-report");
  await expect(report).toContainText("Creamos «Copia Playwright» con 1 sitio, 1 página y 2 bloques");
  await expect(report).toContainText("Todo quedó en borrador");
  await expect(sourceRow.getByTestId("duplicate-needs-review")).toContainText("Números de WhatsApp");
  await expect(sourceRow.getByTestId("duplicate-adjustments")).toContainText("1 imagen de la biblioteca del cliente origen no se copió");
  await sourceRow.getByText("Qué NO se copia nunca").click();
  await expect(report).toContainText("Contactos y respuestas de formularios");
  await expect(report).toContainText("Cuentas de cobro, claves y medios de pago");
  await expectNoHorizontalScroll(page);
  await capture(page, `12-duplicar-informe-${project}.png`);

  // 3. El cliente nuevo aparece en la lista como cualquier alta, esperando a su propietario.
  await page.getByLabel("Buscar cliente").fill("Copia Playwright");
  const copyRow = page.locator(`[data-client-slug="${copySlug}"]`);
  await expect(copyRow).toBeVisible();
  await expect(copyRow.getByTestId("client-status")).toHaveText("Esperando al propietario");
  await expect(copyRow).toContainText(`Invitación enviada a ${copyOwnerEmail}`);

  // 4. En la base: en borrador, con lo permitido y sin NADA sensible ni apuntando al origen.
  const target = await prisma.organization.findUniqueOrThrow({ where: { slug: copySlug }, select: { id: true } });
  const pages = await prisma.page.findMany({ where: { site: { organizationId: target.id } } });
  expect(pages.map((row) => [row.slug, row.status])).toEqual([["inicio", "DRAFT"]]);
  const sites = await prisma.site.findMany({ where: { organizationId: target.id } });
  expect(sites).toHaveLength(1);
  expect(sites[0]?.ga4MeasurementId).toBeNull();
  expect(await prisma.contact.count({ where: { organizationId: target.id } })).toBe(0);
  expect(await prisma.paymentAccount.count({ where: { organizationId: target.id } })).toBe(0);
  const versions = await prisma.blockVersion.findMany({ where: { block: { page: { site: { organizationId: target.id } } } } });
  const everything = JSON.stringify(versions) + JSON.stringify(sites) + JSON.stringify(pages);
  for (const trace of [sourceId, asset, "G-ORIGENPW1", "persona.real@clientes.test"]) expect(everything).not.toContain(trace);
});
