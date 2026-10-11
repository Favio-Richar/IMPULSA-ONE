import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";
import { registerUser } from "../register-user.js";

// F9.7e — portal del cliente (ADR-028 §5), en teléfono y escritorio: el visor del portal entra a su cola de aprobaciones, comenta y aprueba;
// no ve nada más, y quien pidió la publicación la publica después.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = ".playwright/capturas/f97";
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

test("el visor del portal revisa, comenta y aprueba; no ve nada más; el editor publica después", async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const viewerEmail = `portal-visor-${project}-${suffix}@e2e.test`;
  const editorEmail = `portal-editor-${project}-${suffix}@e2e.test`;
  createdEmails.push(viewerEmail, editorEmail);
  const orgPath = `${API_BASE_URL}/organizations/${fixture.organizationId}`;

  const owner = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  const makeUser = async (email: string, role: string) => {
    const api = await apiRequest.newContext({ extraHTTPHeaders: CSRF });
    await registerUser(api, email, PASSWORD);
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    expect((await api.post(`${API_BASE_URL}/auth/login`, { data: { email, password: PASSWORD } })).status()).toBe(201);
    const invite = await owner.post(`${orgPath}/members`, { data: { email, role } });
    expect(invite.status()).toBe(201);
    expect((await api.post(`${API_BASE_URL}/memberships/${((await invite.json()) as { membershipId: string }).membershipId}/accept`)).status()).toBe(204);
    return api;
  };
  const editorApi = await makeUser(editorEmail, "EDITOR");
  const viewerApi = await makeUser(viewerEmail, "CLIENT_VIEWER");

  // Una página con contenido y una solicitud pendiente del editor, con la aprobación exigida.
  const slug = `portal-${project}-${suffix}`;
  const pageResponse = await owner.post(`${orgPath}/sites/${fixture.siteId}/pages`, { data: { slug } });
  expect(pageResponse.status()).toBe(201);
  const pageId = ((await pageResponse.json()) as { id: string }).id;
  createdPageIds.push(pageId);
  expect((await editorApi.post(`${orgPath}/sites/${fixture.siteId}/pages/${pageId}/blocks`, { data: { type: "text", config: { html: "<p>Texto para aprobar</p>", alignment: "left" } } })).status()).toBe(201);
  expect((await owner.put(`${orgPath}/publish-settings`, { data: { requireApproval: true } })).status()).toBe(200);
  const requested = await editorApi.post(`${orgPath}/sites/${fixture.siteId}/pages/${pageId}/publish-requests`, { data: { comment: "Por favor revisa esta página" } });
  expect(requested.status()).toBe(201);

  // --- El visor entra: su inicio es la cola de aprobaciones y el menú solo tiene eso ---
  const viewerContext = await browser.newContext({ ...use, storageState: await viewerApi.storageState() });
  const page = await viewerContext.newPage();
  try {
    await page.addInitScript((id) => {
      window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
    }, fixture.organizationId);
    await page.goto("/");
    await expect(page).toHaveURL(/\/aprobaciones$/);
    await expect(page.getByRole("heading", { name: "Aprobaciones", level: 1 })).toBeVisible();
    if (project === "escritorio") {
      const nav = page.getByRole("navigation", { name: "Navegación principal" }).first();
      await expect(nav.getByRole("link")).toHaveCount(1);
      await expect(nav.getByRole("link", { name: "Aprobaciones" })).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
    await capture(page, `09-portal-visor-cola-${project}.png`);

    // --- Revisa, comenta y aprueba ---
    const row = page.getByTestId("publish-request-row").filter({ hasText: slug });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Revisar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Contenido que se pidió publicar");
    await expect(dialog.getByTestId("comment-thread")).toBeVisible();
    await dialog.getByLabel("Escribe un comentario").fill("¿Puedes confirmar el horario antes de publicar?");
    await dialog.getByRole("button", { name: "Comentar" }).click();
    await expect(dialog.getByTestId("comment").filter({ hasText: "confirmar el horario" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await capture(page, `10-portal-visor-revision-${project}.png`);

    // El visor no puede publicar: aprueba y listo.
    await dialog.getByRole("button", { name: "Aprobar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // --- Lo demás está cerrado: el servidor niega con un código estable ---
    const denied = await viewerApi.get(`${orgPath}/members`);
    expect(denied.status()).toBe(403);
    expect(((await denied.json()) as { code: string }).code).toBe("CLIENT_VIEWER_LIMIT");
    expect((await viewerApi.get(`${orgPath}/contacts`)).status()).toBe(403);
    expect((await viewerApi.post(`${orgPath}/sites/${fixture.siteId}/pages/${pageId}/publish`)).status()).toBe(403);

    // --- Quien pidió la publicación ya puede publicar, y solo así sale la versión ---
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(0);
    expect((await editorApi.post(`${orgPath}/sites/${fixture.siteId}/pages/${pageId}/publish`)).status()).toBe(201);
    expect(await prisma.pageVersion.count({ where: { pageId } })).toBe(1);
  } finally {
    await viewerContext.close();
    await viewerApi.dispose();
    await editorApi.dispose();
    await owner.dispose();
  }
});
