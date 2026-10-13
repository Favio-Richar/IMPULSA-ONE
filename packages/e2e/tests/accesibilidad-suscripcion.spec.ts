import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import axe from "axe-core";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// Extra F10 — barrido de accesibilidad (WCAG 2.2 AA, axe-core A y AA) de la suscripción, en teléfono y escritorio: el panel, la
// portada con su botón y la página de suscripción (con y sin el aviso de error visible). Una violación falla con regla y elemento.

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const prisma = new PrismaClient();

let api: APIRequestContext;
let blockId = "";

async function revalidate(): Promise<void> {
  const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, { headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET }, data: { siteSlug: fixture.siteSlug } });
  expect(response.status()).toBe(200);
}

test.beforeAll(async () => {
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  await prisma.subscribePage.upsert({
    where: { siteId: fixture.siteId },
    create: {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      enabled: true,
      title: "Únete a mi comunidad",
      description: "Cada semana comparto clases y recursos.",
      benefits: ["Clases en vivo", "Recursos descargables"],
      freeEnabled: true,
    },
    update: { enabled: true },
  });
  const response = await api.post(blocksPath, { headers: CSRF, data: { type: "subscribe", config: { label: "Suscríbete", description: "Contenido exclusivo" } } });
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
  await prisma.subscribePage.deleteMany({ where: { siteId: fixture.siteId } });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, targetType: "SubscribePage" } });
  await prisma.$disconnect();
});

async function audit(page: Page, label: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    }));
  });
  expect(violations, `${label}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
}

test("panel · suscripción", async ({ page }) => {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto(`/sitios/${fixture.siteId}/suscripcion`);
  await expect(page.getByRole("heading", { name: "Suscripción", exact: true })).toBeVisible();
  await expect(page.getByRole("form", { name: "Datos de la página de suscripción" })).toBeVisible();
  await audit(page, "panel suscripción");
});

test.describe("Público", () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: PUBLIC_WEB_URL });

  test("portada con el botón de suscripción", async ({ page }) => {
    await page.goto(`/${fixture.siteSlug}`);
    await expect(page.getByRole("link", { name: /Suscríbete/ })).toBeVisible({ timeout: 30_000 });
    await audit(page, "portada con botón");
  });

  test("página de suscripción, en reposo y con el aviso de error", async ({ page }) => {
    await page.goto(`/${fixture.siteSlug}/s`);
    await expect(page.getByRole("heading", { name: "Únete a mi comunidad" })).toBeVisible();
    await audit(page, "suscripción en reposo");
    await page.getByRole("button", { name: "Suscribirme gratis" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "correo válido" })).toBeVisible();
    await audit(page, "suscripción con error");
  });
});
