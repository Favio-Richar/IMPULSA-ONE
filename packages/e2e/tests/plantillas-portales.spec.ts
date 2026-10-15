import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import axe from "axe-core";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// Plantillas del editor de portales, en la página pública REAL (build de producción): se aplica cada plantilla a un sitio propio,
// se publican sus tres páginas y se verifica que las vistas y «me gusta» aparezcan justo bajo el perfil (2 plantillas base y 3
// nuevas), que los botones del inicio lleven a las páginas internas, y que la esfera 3D y el índice con portada funcionen.

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/plantillas-portales";
const CSRF = { "X-Requested-With": "impulza-one" };
const org = `${API_BASE_URL}/organizations/${fixture.organizationId}`;
const prisma = new PrismaClient();
const startedAt = new Date();
const created: string[] = [];

let api: APIRequestContext;
let previousPlanId: string | null = null;

/** Crea un sitio, le aplica la plantilla (con su tema y fondo) y publica todas sus páginas. Devuelve su dirección pública. */
async function siteFromTemplate(templateCode: string, project: string): Promise<{ slug: string; pages: string[] }> {
  const slug = `tpl-${templateCode.slice(0, 18)}-${project.slice(0, 3)}-${Date.now().toString(36)}`;
  const site = await api.post(`${org}/sites`, { headers: CSRF, data: { name: `Portal ${templateCode}`, slug } });
  expect(site.status(), await site.text()).toBe(201);
  const siteId = ((await site.json()) as { id: string }).id;
  created.push(siteId);
  const pagesPath = `${org}/sites/${siteId}/pages`;
  const home = ((await (await api.get(pagesPath)).json()) as Array<{ id: string }>)[0]!;
  const applied = await api.post(`${pagesPath}/${home.id}/apply-template`, {
    headers: CSRF,
    data: { templateCode, applyAppearance: true, discardUnpublishedChanges: true },
  });
  expect(applied.status(), await applied.text()).toBe(200);
  const pages = (await (await api.get(pagesPath)).json()) as Array<{ id: string; slug: string; isHome: boolean }>;
  expect(pages.length, `${templateCode}: inicio + 2 páginas`).toBe(3);
  for (const page of pages) {
    const published = await api.post(`${pagesPath}/${page.id}/publish`, { headers: CSRF });
    expect(published.status(), await published.text()).toBe(201);
  }
  const revalidated = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, { headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET }, data: { siteSlug: slug } });
  expect(revalidated.status()).toBe(200);
  return { slug, pages: pages.filter((page) => !page.isHome).map((page) => page.slug) };
}

async function expectEngagementUnderProfile(page: Page, label: string): Promise<void> {
  const engagement = page.getByRole("group", { name: "Vistas y me gusta" });
  await expect(engagement, label).toBeVisible({ timeout: 20_000 });
  await expect(engagement.getByText(/vistas?/)).toBeVisible();
  await expect(engagement.getByRole("button", { name: /Me gusta/ })).toBeVisible();
  // Justo debajo del perfil: es el segundo bloque de la página.
  const order = await page.locator("[data-block-type]").evaluateAll((blocks) => blocks.slice(0, 2).map((block) => (block as HTMLElement).dataset.blockType));
  expect(order, label).toEqual(["profile", "engagement"]);
}

async function audit(page: Page, label: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((violation) => ({
      rule: violation.id,
      nodes: violation.nodes.slice(0, 3).map((node) => ({ target: node.target.join(" "), data: node.any[0]?.data ?? null })),
    }));
  });
  expect(violations, `${label}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
}

test.beforeAll(async () => {
  previousPlanId = (await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } })).planId;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id } });
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
});

test.afterAll(async () => {
  await api.dispose();
  // La organización sembrada la comparten todas las pruebas: se deja como estaba.
  if (created.length > 0) await prisma.site.deleteMany({ where: { id: { in: created } } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId } });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, createdAt: { gte: startedAt } } });
  await prisma.$disconnect();
});

for (const code of ["belleza-barberia", "musico-banda"]) {
  test(`plantilla existente «${code}»: vistas y «me gusta» bajo el perfil en la página pública`, async ({ page }, testInfo) => {
    const site = await siteFromTemplate(code, testInfo.project.name);
    await page.goto(`${PUBLIC_WEB_URL}/${site.slug}`);
    await expectEngagementUnderProfile(page, code);
    await page.screenshot({ path: `${CAPTURES}/${code}-${testInfo.project.name}.png`, fullPage: true });
  });
}

test("nueva «clinica-dental»: vistas y «me gusta», y el botón principal lleva a la página interna de reservas", async ({ page }, testInfo) => {
  const site = await siteFromTemplate("clinica-dental", testInfo.project.name);
  await page.goto(`${PUBLIC_WEB_URL}/${site.slug}`);
  await expectEngagementUnderProfile(page, "clinica-dental");
  // Sin suscripción: es un servicio de salud.
  await expect(page.locator("[data-subscribe]")).toHaveCount(0);
  await audit(page, "clinica-dental inicio");
  await page.screenshot({ path: `${CAPTURES}/clinica-dental-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("link", { name: /Reserva tu hora/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/${site.slug}/reservas$`));
  await expect(page.getByRole("heading", { name: "Agenda tu evaluación" })).toBeVisible();
});

test("nueva «musica-podcast»: suscripción, y el índice con portada muestra la portada al enfocar una fila", async ({ page }, testInfo) => {
  const site = await siteFromTemplate("musica-podcast", testInfo.project.name);
  await page.goto(`${PUBLIC_WEB_URL}/${site.slug}`);
  await expectEngagementUnderProfile(page, "musica-podcast");
  await expect(page.locator("[data-subscribe]")).toHaveCount(1);
  const index = page.locator("[data-showcase-index]");
  await expect(index).toBeVisible();
  await audit(page, "musica-podcast en reposo");
  // Con el foco del teclado en una fila, aparece su portada con el velo y el texto pasa a blanco (AA sobre cualquier foto).
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const row = index.getByRole("link", { name: /Ep\. 48/ });
  await row.focus();
  await expect(index).toHaveAttribute("data-active", "");
  await expect.poll(() => row.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
  await page.waitForTimeout(800);
  await index.screenshot({ path: `${CAPTURES}/musica-podcast-indice-activo-${testInfo.project.name}.png` });
  await page.screenshot({ path: `${CAPTURES}/musica-podcast-${testInfo.project.name}.png`, fullPage: true });
});

test("nueva «estudio-tatuajes»: la esfera 3D del portafolio gira, se pausa y abre cada foto en un visor accesible", async ({ page }, testInfo) => {
  const site = await siteFromTemplate("estudio-tatuajes", testInfo.project.name);
  await page.goto(`${PUBLIC_WEB_URL}/${site.slug}`);
  await expectEngagementUnderProfile(page, "estudio-tatuajes");
  await page.screenshot({ path: `${CAPTURES}/estudio-tatuajes-${testInfo.project.name}.png`, fullPage: true });

  await page.goto(`${PUBLIC_WEB_URL}/${site.slug}/portafolio`);
  const sphere = page.locator('[data-gallery-sphere=""]');
  await expect(sphere).toBeVisible();
  const stage = sphere.getByRole("group", { name: /Galería en esfera, 5 fotos/ });
  // Gira sola: la posición de una foto cambia con el tiempo.
  const first = stage.getByRole("button").first();
  const before = await first.evaluate((el) => (el as HTMLElement).style.transform);
  await page.waitForTimeout(600);
  expect(await first.evaluate((el) => (el as HTMLElement).style.transform)).not.toBe(before);
  // Se puede pausar (WCAG 2.2.2).
  await sphere.getByRole("button", { name: "Pausar giro" }).click();
  await expect(sphere.getByRole("button", { name: "Girar sola" })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: `${CAPTURES}/estudio-tatuajes-esfera-${testInfo.project.name}.png`, fullPage: true });
  // Cada foto se abre en un visor con foco y se cierra con Escape.
  await stage.getByRole("button", { name: /Ver en grande: Foto de ejemplo: tatuaje en proceso/ }).click({ force: true });
  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Cerrar" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await audit(page, "estudio-tatuajes portafolio");
});
