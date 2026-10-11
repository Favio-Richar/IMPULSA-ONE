import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F10.1 (ADR-029) — miembros de sitio y contenido protegido, en teléfono y escritorio: una página «solo miembros» muestra una puerta
// a quien no tiene acceso, el miembro entra con su enlace de un solo uso, ve el contenido, y al revocarlo la puerta vuelve.

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = "../../docs/design/capturas/f101";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const SECRET = "CONTENIDO-EXCLUSIVO-E2E";
const orgPath = `${API_BASE_URL}/organizations/${fixture.organizationId}`;
const createdPageIds: string[] = [];
const createdMemberEmails: string[] = [];

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba (las de auditoría cuentan sus filas).
  await prisma.siteMember.deleteMany({ where: { siteId: fixture.siteId, email: { in: createdMemberEmails } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, OR: [{ targetType: "SiteMember" }, { targetId: { in: createdPageIds } }] } });
  await prisma.page.deleteMany({ where: { id: { in: createdPageIds } } });
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

/** El sitio público está en caché: se invalida por la vía oficial, como lo hace la API tras un cambio. */
async function revalidate(): Promise<void> {
  const api = await apiRequest.newContext();
  try {
    const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
      headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
      data: { siteSlug: fixture.siteSlug },
    });
    expect(response.status()).toBe(200);
  } finally {
    await api.dispose();
  }
}

/** Equivale a lo que hace la API al enviar el correo: un token de un solo uso del que solo se guarda el hash. */
async function issueLoginToken(memberEmail: string): Promise<string> {
  const member = await prisma.siteMember.findUniqueOrThrow({ where: { siteId_email: { siteId: fixture.siteId, email: memberEmail } } });
  const token = randomBytes(32).toString("base64url");
  await prisma.siteMemberLoginToken.create({
    data: { memberId: member.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  return token;
}

test("la puerta, el enlace de un solo uso, el contenido y la revocación", async ({ browser, page }, testInfo) => {
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const pageSlug = `miembros-${project}-${suffix}`;
  const memberEmail = `socio-${project}-${suffix}@e2e.test`;
  createdMemberEmails.push(memberEmail);

  // --- Preparación por la API: una página publicada con un texto exclusivo ---
  const owner = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  const created = await owner.post(`${orgPath}/sites/${fixture.siteId}/pages`, { data: { slug: pageSlug } });
  expect(created.status()).toBe(201);
  const pageId = ((await created.json()) as { id: string }).id;
  createdPageIds.push(pageId);
  expect((await owner.post(`${orgPath}/sites/${fixture.siteId}/pages/${pageId}/blocks`, { data: { type: "text", config: { html: `<p>${SECRET}</p>`, alignment: "left" } } })).status()).toBe(201);
  expect((await owner.post(`${orgPath}/sites/${fixture.siteId}/pages/${pageId}/publish`)).status()).toBe(201);

  // --- Panel: marcar la página como solo para miembros y agregar al miembro, por la interfaz ---
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto(`/sitios/${fixture.siteId}/miembros`);
  await expect(page.getByRole("heading", { name: "Miembros y contenido protegido" })).toBeVisible();
  await page.getByRole("checkbox", { name: new RegExp(`Solo miembros.*${pageSlug}`) }).check();
  await expect(page.getByRole("checkbox", { name: new RegExp(`Solo miembros.*${pageSlug}`) })).toBeChecked();

  const form = page.getByRole("form", { name: "Agregar miembro" });
  await form.getByRole("button", { name: "Agregar miembro" }).click();
  await expect(form.getByText("Escribe un correo válido.")).toBeVisible();
  await form.getByRole("textbox", { name: "Correo" }).fill(memberEmail);
  await form.getByLabel("Nombre (opcional)").fill("Socia E2E");
  await form.getByLabel("Enviarle su enlace de acceso por correo ahora").uncheck();
  await form.getByRole("button", { name: "Agregar miembro" }).click();
  const row = page.getByRole("listitem").filter({ hasText: memberEmail });
  await expect(row).toBeVisible();
  await expect(row.getByText("Activo")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `01-panel-miembros-${project}.png`);
  await revalidate();

  // --- Visitante sin acceso: ve la puerta y NADA del contenido ---
  const visitor = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
  const web = await visitor.newPage();
  await web.goto(`/${fixture.siteSlug}/${pageSlug}`);
  await expect(web.getByRole("heading", { name: "Contenido para miembros" })).toBeVisible();
  expect(await web.content()).not.toContain(SECRET);
  await expectNoHorizontalScroll(web);
  await capture(web, `02-puerta-${project}.png`);

  // El correo se valida y la respuesta no delata si es miembro.
  await web.getByLabel("Tu correo").fill("no-es-correo");
  await web.getByRole("button", { name: "Enviarme el enlace" }).click();
  await expect(web.getByRole("alert").filter({ hasText: "Escribe un correo válido." })).toBeVisible();
  await web.getByLabel("Tu correo").fill(`desconocido-${suffix}@e2e.test`);
  await web.getByRole("button", { name: "Enviarme el enlace" }).click();
  await expect(web.getByRole("status")).toContainText("Si ");

  // --- El miembro entra con su enlace: un clic, una sola vez ---
  const token = await issueLoginToken(memberEmail);
  await web.goto(`/miembros/${token}`);
  await expect(web.getByRole("heading", { name: "Entrar al contenido para miembros" })).toBeVisible();
  await capture(web, `03-entrar-${project}.png`);
  await web.getByRole("button", { name: "Entrar" }).click();
  await expect(web).toHaveURL(new RegExp(`/${fixture.siteSlug}$`));

  // La sesión es una cookie HttpOnly de este sitio, nunca legible por el script de la página.
  const cookie = (await visitor.cookies()).find((item) => item.name === `impulza_member_${fixture.siteSlug}`);
  expect(cookie?.httpOnly).toBe(true);
  expect(await web.evaluate(() => document.cookie)).not.toContain("impulza_member_");

  await web.goto(`/${fixture.siteSlug}/${pageSlug}`);
  await expect(web.getByText(SECRET)).toBeVisible();
  await expect(web.getByRole("button", { name: "Salir de mi acceso" })).toBeVisible();
  await expectNoHorizontalScroll(web);
  await capture(web, `04-contenido-${project}.png`);

  // El enlace ya no sirve.
  const second = await visitor.newPage();
  await second.goto(`${PUBLIC_WEB_URL}/miembros/${token}`);
  await second.getByRole("button", { name: "Entrar" }).click();
  await expect(second.getByRole("alert").filter({ hasText: "no es válido o ya venció" })).toBeVisible();
  await second.close();

  // --- Revocar desde el panel: la puerta vuelve en el acto ---
  await page.reload();
  const again = page.getByRole("listitem").filter({ hasText: memberEmail });
  await again.getByRole("button", { name: "Revocar" }).click();
  await again.getByRole("button", { name: "Sí" }).click();
  await expect(again.getByText("Revocado")).toBeVisible();
  await capture(page, `05-panel-revocado-${project}.png`);

  await web.reload();
  await expect(web.getByRole("heading", { name: "Contenido para miembros" })).toBeVisible();
  expect(await web.content()).not.toContain(SECRET);

  // --- Salir de mi acceso (con un miembro reactivado) cierra la sesión del servidor ---
  await again.getByRole("button", { name: "Reactivar" }).click();
  await expect(again.getByText("Activo")).toBeVisible();
  const token2 = await issueLoginToken(memberEmail);
  await web.goto(`/miembros/${token2}`);
  await web.getByRole("button", { name: "Entrar" }).click();
  await expect(web).toHaveURL(new RegExp(`/${fixture.siteSlug}$`));
  await web.goto(`/${fixture.siteSlug}/${pageSlug}`);
  await expect(web.getByText(SECRET)).toBeVisible();
  await web.getByRole("button", { name: "Salir de mi acceso" }).click();
  await expect(web.getByRole("heading", { name: "Contenido para miembros" })).toBeVisible();
  expect(await web.content()).not.toContain(SECRET);

  await visitor.close();
  await owner.dispose();
});

test("un enlace inventado y una forma inválida no revelan nada", async ({ browser }, testInfo) => {
  const use = testInfo.project.use as BrowserContextOptions;
  const context = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
  const web = await context.newPage();
  // Forma que no puede ser un token: 404 de la plataforma.
  const bad = await web.goto("/miembros/esto-no-es-un-token");
  expect(bad?.status()).toBe(404);
  // Forma válida pero inexistente: la página carga y el canje responde un único mensaje.
  await web.goto(`/miembros/${"A".repeat(43)}`);
  await web.getByRole("button", { name: "Entrar" }).click();
  await expect(web.getByRole("alert").filter({ hasText: "no es válido o ya venció" })).toBeVisible();
  await context.close();
});
