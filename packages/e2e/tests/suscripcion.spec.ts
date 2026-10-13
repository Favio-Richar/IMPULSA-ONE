import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type APIRequestContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// Extra F10 (ADR-029) — suscripción, en teléfono y escritorio: el portal lleva UN botón «Suscribirme» (sin formularios ni cifras
// en la portada); al tocarlo, la persona llega a la página de suscripción que el negocio personalizó y se suscribe gratis.

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const CAPTURES = "../../docs/design/capturas/suscripcion";
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const BUTTON_LABEL = `Únete al club ${suffix}`;

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

test.describe("portal y página de suscripción", () => {
  let api: APIRequestContext;
  let blockId = "";
  const emails: string[] = [];

  async function revalidate(): Promise<void> {
    const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, { headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET }, data: { siteSlug: fixture.siteSlug } });
    expect(response.status()).toBe(200);
  }

  test.beforeAll(async () => {
    api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
    const response = await api.post(blocksPath, { headers: CSRF, data: { type: "subscribe", config: { label: BUTTON_LABEL, description: "Contenido exclusivo" } } });
    expect(response.status(), await response.text()).toBe(201);
    blockId = ((await response.json()) as { id: string }).id;
    expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
    await revalidate();
  });

  test.afterAll(async () => {
    if (blockId) await api.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
    await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
    await revalidate();
    await api.dispose();
    // La organización sembrada la comparten todas las pruebas: se deja como estaba.
    await prisma.siteMember.deleteMany({ where: { siteId: fixture.siteId, email: { in: emails } } });
    await prisma.subscribePage.deleteMany({ where: { siteId: fixture.siteId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, targetType: { in: ["SubscribePage", "SiteMember"] } } });
    await prisma.$disconnect();
  });

  test("el negocio personaliza su página de suscripción desde el panel", async ({ page }, testInfo) => {
    await page.addInitScript((id) => {
      window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
    }, fixture.organizationId);
    await page.goto(`/sitios/${fixture.siteId}/suscripcion`);
    await expect(page.getByRole("heading", { name: "Suscripción", exact: true })).toBeVisible();

    const form = page.getByRole("form", { name: "Datos de la página de suscripción" });
    await form.getByLabel("Título").fill("");
    await form.getByRole("button", { name: "Guardar página" }).click();
    await expect(form.getByRole("alert").filter({ hasText: "Escribe un título" })).toBeVisible();

    await form.getByLabel("Título").fill(`Únete a mi comunidad ${suffix}`);
    await form.getByLabel("Descripción").fill("Cada semana comparto clases y recursos que no publico en ningún otro lado.");
    await form.getByRole("button", { name: "Agregar beneficio" }).click();
    await form.getByLabel("Beneficio 1", { exact: true }).fill("Clases en vivo");
    await form.getByRole("button", { name: "Agregar beneficio" }).click();
    await form.getByLabel("Beneficio 2", { exact: true }).fill("Recursos descargables");
    await form.getByRole("button", { name: "Guardar página" }).click();
    await expect(page.getByText("Página guardada.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tu página está activa" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await capture(page, `01-panel-${testInfo.project.name}.png`);
  });

  test("la portada lleva un solo botón y la suscripción ocurre en su página", async ({ browser }, testInfo) => {
    const use = testInfo.project.use as BrowserContextOptions;
    const context = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
    const web = await context.newPage();

    // --- Portada: un botón, sin formularios, correos ni cifras ---
    await web.goto(`/${fixture.siteSlug}`);
    const button = web.getByRole("link", { name: new RegExp(BUTTON_LABEL) });
    await expect(button).toBeVisible({ timeout: 30_000 });
    await expect(button).toHaveAttribute("href", `/${fixture.siteSlug}/s`);
    await expect(web.locator('input[type="email"]')).toHaveCount(0);
    await expect(web.getByRole("button", { name: /Suscribirme/ })).toHaveCount(0);
    await expectNoHorizontalScroll(web);
    await capture(web, `02-portada-${testInfo.project.name}.png`);

    // --- Página de suscripción: contenido del negocio y suscripción gratuita ---
    await button.click();
    await expect(web).toHaveURL(new RegExp(`/${fixture.siteSlug}/s$`));
    await expect(web.getByRole("heading", { name: `Únete a mi comunidad ${suffix}` })).toBeVisible();
    await expect(web.getByText("Clases en vivo")).toBeVisible();
    await expect(web.getByText("Recursos descargables")).toBeVisible();

    const email = `fan-${testInfo.project.name}-${suffix}@suscripcion-e2e.test`;
    emails.push(email);
    const submit = web.getByRole("button", { name: "Suscribirme gratis" });
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await submit.click();
    await expect(web.getByText("Escribe un correo válido", { exact: false })).toBeVisible();
    await web.getByLabel("Tu correo").fill(email);
    await capture(web, `03-pagina-${testInfo.project.name}.png`);
    await submit.click();
    await expect(web.getByText("Revisa tu correo")).toBeVisible();
    await expect(web.getByRole("status")).toContainText("Te enviamos un enlace");
    await expectNoHorizontalScroll(web);
    await capture(web, `04-enviado-${testInfo.project.name}.png`);

    // El servidor lo guardó como suscriptor gratuito de este sitio.
    await expect.poll(() => prisma.siteMember.count({ where: { siteId: fixture.siteId, email, source: "FREE", status: "ACTIVE" } })).toBe(1);
    await context.close();
  });

  test("una página de suscripción que no existe o está apagada responde 404", async ({ browser }, testInfo) => {
    const use = testInfo.project.use as BrowserContextOptions;
    const context = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
    const web = await context.newPage();
    expect((await web.goto(`/sitio-que-no-existe-${suffix}/s`))?.status()).toBe(404);
    await prisma.subscribePage.updateMany({ where: { siteId: fixture.siteId }, data: { enabled: false } });
    expect((await web.goto(`/${fixture.siteSlug}/s`))?.status()).toBe(404);
    await context.close();
  });
});
