import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";
import { registerUser } from "../register-user.js";

// F9.6c — aprobación antes de publicar (ADR-028 §3), en teléfono y escritorio. El propietario activa la opción; una persona del equipo
// pide publicar; el propietario revisa el contenido y aprueba (o rechaza con motivo); y solo entonces la persona publica.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = ".playwright/capturas/f96";
const PASSWORD = "password1234";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const createdEmails: string[] = [];
const createdPageIds: string[] = [];
let previousPlanId: string | null = null;

test.beforeAll(async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } });
  previousPlanId = org.planId;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id } });
});

test.afterAll(async () => {
  await prisma.publishRequest.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.page.deleteMany({ where: { id: { in: createdPageIds } } });
  await prisma.membership.deleteMany({ where: { organizationId: fixture.organizationId, user: { email: { in: createdEmails } } } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId, requirePublishApproval: false } });
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

const orgPath = `${API_BASE_URL}/organizations/${fixture.organizationId}`;

test("pedir, revisar, aprobar y publicar; y un rechazo con motivo que la persona lee", async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const slug = `aprob-${project}-${suffix}`;
  const email = `redactor-${project}-${suffix}@e2e.test`;
  createdEmails.push(email);

  // --- Preparación por la API: una página con contenido y una persona con rol Editor ---
  const ownerApi = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  const pageResponse = await ownerApi.post(`${orgPath}/sites/${fixture.siteId}/pages`, { data: { slug } });
  expect(pageResponse.status()).toBe(201);
  const pageId = ((await pageResponse.json()) as { id: string }).id;
  createdPageIds.push(pageId);
  const blockResponse = await ownerApi.post(`${orgPath}/sites/${fixture.siteId}/pages/${pageId}/blocks`, {
    data: { type: "text", config: { html: "<p>Primera versión del texto</p>", alignment: "left" } },
  });
  expect(blockResponse.status()).toBe(201);
  const blockId = ((await blockResponse.json()) as { id: string }).id;

  const editorApi = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
  await registerUser(editorApi, email, PASSWORD);
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  expect((await editorApi.post(`${API_BASE_URL}/auth/login`, { data: { email, password: PASSWORD } })).status()).toBe(201);
  const invite = await ownerApi.post(`${orgPath}/members`, { data: { email, role: "EDITOR" } });
  expect(invite.status()).toBe(201);
  expect((await editorApi.post(`${API_BASE_URL}/memberships/${((await invite.json()) as { membershipId: string }).membershipId}/accept`)).status()).toBe(204);

  // --- El propietario activa la opción desde Configuración ---
  await activateOrg(page);
  await page.goto("/configuracion");
  const settings = page.getByTestId("publish-settings-card");
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("desactivada");
  await settings.getByRole("button", { name: "Activar" }).click();
  await expect(settings).toContainText("activada");
  await expect(settings.getByRole("button", { name: "Desactivar" })).toBeEnabled();
  await expectNoHorizontalScroll(page);
  await capture(page, `12-aprobacion-opcion-${project}.png`);

  // --- La persona del equipo pide la aprobación desde el editor ---
  const editorContext = await browser.newContext({ ...use, storageState: await editorApi.storageState() });
  const editorPage = await editorContext.newPage();
  try {
    await activateOrg(editorPage);
    // Quien no es propietario ve la opción pero no puede cambiarla.
    await editorPage.goto("/configuracion");
    await expect(editorPage.getByTestId("publish-settings-card").getByRole("button", { name: "Desactivar" })).toBeDisabled();

    await editorPage.goto(`/sitios/${fixture.siteId}/paginas/${pageId}/editor`);
    const ask = editorPage.getByRole("button", { name: "Pedir aprobación" });
    await expect(ask).toBeVisible();
    await expect(editorPage.getByRole("status").filter({ hasText: "exige aprobación antes de publicar" })).toBeVisible();
    await capture(editorPage, `13-aprobacion-editor-pide-${project}.png`);
    await ask.click();
    const dialog = editorPage.getByRole("dialog", { name: "Pedir aprobación para publicar" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Comentario (opcional)").fill("Listo para revisar, cambié el texto.");
    await expectNoHorizontalScroll(editorPage);
    await capture(editorPage, `14-aprobacion-dialogo-${project}.png`);
    await dialog.getByRole("button", { name: "Enviar solicitud" }).click();
    await expect(editorPage.getByText("Solicitud enviada. Quien pueda aprobar recibió un aviso.")).toBeVisible();
    await expect(editorPage.getByRole("button", { name: "Esperando aprobación" })).toBeDisabled();
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(0);

    // --- El propietario revisa el contenido pedido y aprueba ---
    await page.goto("/aprobaciones");
    await expect(page.getByRole("heading", { name: "Aprobaciones", level: 1 })).toBeVisible();
    const row = page.getByTestId("publish-request-row").filter({ hasText: slug });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Pendiente");
    await expect(row).toContainText(email);
    await expectNoHorizontalScroll(page);
    await capture(page, `15-aprobacion-cola-${project}.png`);
    await row.getByRole("button", { name: "Revisar" }).click();
    const review = page.getByRole("dialog");
    await expect(review).toContainText("Contenido que se pidió publicar");
    await expect(review).toContainText("Listo para revisar, cambié el texto.");
    await expectNoHorizontalScroll(page);
    await capture(page, `16-aprobacion-revision-${project}.png`);
    await review.getByRole("button", { name: "Aprobar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("No hay solicitudes pendientes")).toBeVisible();

    // --- La persona ve la aprobación y publica; solo así sale la versión ---
    await editorPage.reload();
    await expect(editorPage.getByRole("status").filter({ hasText: "Ya puedes publicarla" })).toBeVisible();
    const publish = editorPage.getByRole("button", { name: "Publicar", exact: true });
    await expect(publish).toBeEnabled();
    await capture(editorPage, `17-aprobacion-aprobada-${project}.png`);
    await publish.click();
    await expect(editorPage.getByText("Publicado.")).toBeVisible();
    await expect.poll(() => prisma.pageVersion.count({ where: { pageId } })).toBe(1);
    const consumed = await prisma.publishRequest.findFirstOrThrow({ where: { pageId }, orderBy: { createdAt: "desc" } });
    expect(consumed.status).toBe("APPROVED");
    expect(consumed.consumedAt).not.toBeNull();

    // --- Segundo cambio: se pide y el propietario RECHAZA con motivo; la persona lo lee ---
    expect(
      (await ownerApi.patch(`${orgPath}/sites/${fixture.siteId}/pages/${pageId}/blocks/${blockId}`, {
        data: { config: { html: "<p>Segunda versión, con un error</p>", alignment: "left" } },
      })).status(),
    ).toBe(200);
    await editorPage.reload();
    await editorPage.getByRole("button", { name: "Pedir aprobación" }).click();
    await editorPage.getByRole("dialog").getByRole("button", { name: "Enviar solicitud" }).click();
    await expect(editorPage.getByRole("button", { name: "Esperando aprobación" })).toBeDisabled();

    await page.goto("/aprobaciones");
    await page.getByTestId("publish-request-row").filter({ hasText: slug }).getByRole("button", { name: "Revisar" }).click();
    const rejectDialog = page.getByRole("dialog");
    await rejectDialog.getByRole("button", { name: "Rechazar", exact: true }).click();
    const submitReject = rejectDialog.getByRole("button", { name: "Rechazar solicitud" });
    await expect(submitReject).toBeDisabled();
    await rejectDialog.getByLabel("Motivo del rechazo").fill("Falta corregir el error del texto.");
    await expect(submitReject).toBeEnabled();
    await capture(page, `18-aprobacion-rechazo-${project}.png`);
    await submitReject.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await editorPage.reload();
    const rejectedNotice = editorPage.getByRole("status").filter({ hasText: "rechazó la solicitud" });
    await expect(rejectedNotice).toContainText("Falta corregir el error del texto.");
    await expect(editorPage.getByRole("button", { name: "Pedir aprobación" })).toBeEnabled();
    await expectNoHorizontalScroll(editorPage);
    await capture(editorPage, `19-aprobacion-rechazada-${project}.png`);
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(1);

    // --- Historial: el filtro por estado y la paginación en el servidor ---
    await page.goto("/aprobaciones");
    await page.getByLabel("Mostrar").selectOption({ label: "Todas" });
    await expect(page.getByTestId("publish-request-row").filter({ hasText: slug })).toHaveCount(2);
    await page.getByLabel("Mostrar").selectOption({ label: "Rechazadas" });
    await expect(page.getByTestId("publish-request-row").filter({ hasText: slug })).toHaveCount(1);
    await expect(page.getByTestId("publish-request-row").filter({ hasText: slug })).toContainText("Rechazada");
    await expectNoHorizontalScroll(page);
    await capture(page, `20-aprobacion-historial-${project}.png`);
  } finally {
    await editorContext.close();
    await editorApi.dispose();
    await ownerApi.dispose();
  }
});
