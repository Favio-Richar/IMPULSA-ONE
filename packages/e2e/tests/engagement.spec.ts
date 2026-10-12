import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F10 — vistas y «me gusta» de la página pública: el botón responde al instante, el servidor cuenta una sola vez por
// visitante y el estado sobrevive a recargar. En teléfono y escritorio, sin desbordes.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const prisma = new PrismaClient();

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("página publicada", () => {
  let api: APIRequestContext;
  let blockId = "";

  async function revalidate(): Promise<void> {
    const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, { headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET }, data: { siteSlug: fixture.siteSlug } });
    expect(response.status()).toBe(200);
  }

  test.beforeAll(async () => {
    api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
    await prisma.pageLike.deleteMany({ where: { pageId: fixture.pageId } });
    const response = await api.post(blocksPath, { headers: CSRF, data: { type: "engagement", config: { likeLabel: "Me encanta" } } });
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
    await prisma.pageLike.deleteMany({ where: { pageId: fixture.pageId } });
    await prisma.pageEngagement.deleteMany({ where: { pageId: fixture.pageId } });
    await prisma.$disconnect();
  });

  test("muestra las cifras, da «me gusta» una sola vez, lo recuerda al recargar y se puede quitar", async ({ browser, viewport }, testInfo) => {
    const context = await browser.newContext({ viewport: viewport!, locale: "es-CL" });
    const page = await context.newPage();
    await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);

    const group = page.getByRole("group", { name: "Vistas y me gusta" });
    await expect(group).toBeVisible({ timeout: 30_000 });
    const like = group.getByRole("button", { name: /Me encanta/ });
    await expect(like).toHaveAttribute("aria-pressed", "false");
    expect((await like.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const before = Number((await like.innerText()).replace(/\D/g, "").slice(-3) || "0");

    await like.click();
    await expect(like).toHaveAttribute("aria-pressed", "true");
    await expect(like).toContainText(String(before + 1));
    await page.screenshot({ path: `.playwright/capturas/engagement/like-${testInfo.project.name}.png`, fullPage: true });

    // El servidor lo guardó: recargar lo sigue mostrando, y la base cuenta uno.
    await page.reload();
    const again = page.getByRole("group", { name: "Vistas y me gusta" }).getByRole("button", { name: /Me encanta/ });
    await expect(again).toHaveAttribute("aria-pressed", "true");
    expect(await prisma.pageLike.count({ where: { pageId: fixture.pageId } })).toBe(1);

    await again.click();
    await expect(again).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => prisma.pageLike.count({ where: { pageId: fixture.pageId } })).toBe(0);
    await expectNoHorizontalScroll(page);
    await context.close();
  });
});
