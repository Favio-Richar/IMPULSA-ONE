import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// Pantalla «Crear sitio» del panel: en blanco, desde una plantilla (misma operación que el asistente) y duplicando.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;

async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((violation) => violation.id + ": " + violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | "));
  });
}

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let previousPlanId: string | null = null;

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test("crear sitio: la dirección se propone desde el nombre y se comprueba en vivo", async ({ page }) => {
  await page.goto("/sitios/nuevo");
  await expect(page.getByRole("heading", { name: "Crear sitio" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Nombre del sitio").fill("Café Aroma Prueba");
  await expect(page.getByLabel("Dirección pública")).toHaveValue("cafe-aroma-prueba");
  await expect(page.getByText(/Parece disponible|ya está en uso/)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `../../docs/design/capturas/sitio/nuevo-${test.info().project.name}.png`, fullPage: true });
  expect(await axeViolations(page)).toEqual([]);
});

test("con el plan al límite, crear un sitio muestra el aviso del plan y no el error genérico", async ({ page }) => {
  await page.goto("/sitios/nuevo");
  await page.getByLabel("Nombre del sitio").fill("Sitio Limite");
  await page.getByLabel("Dirección pública").fill(`limite-${suffix}`);
  await page.getByRole("button", { name: "Crear sitio en blanco" }).click();
  await expect(page.getByText(/Llegaste al máximo de sitios de tu plan/)).toBeVisible({ timeout: 30_000 });
});

test.describe("con un plan que permite varios sitios", () => {
test.beforeAll(async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } });
  previousPlanId = org.planId;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id } });
});

test.afterAll(async () => {
  await prisma.site.deleteMany({
    where: { organizationId: fixture.organizationId, id: { not: fixture.siteId }, OR: [{ slug: { startsWith: "blanco-" } }, { slug: { startsWith: "plantilla-" } }, { slug: { startsWith: "copia-" } }] },
  });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId } });
  await prisma.$disconnect();
});

test("crear sitio en blanco sigue funcionando y abre el sitio", async ({ page }) => {
  const id = unique();
  await page.goto("/sitios/nuevo");
  await page.getByLabel("Nombre del sitio").fill(`Blanco ${id}`);
  await page.getByLabel("Dirección pública").fill(`blanco-${id}`);
  await page.getByRole("button", { name: "Crear sitio en blanco" }).click();
  await expect(page).toHaveURL(/\/sitios\/[0-9a-f-]{36}/, { timeout: 30_000 });
});

test("crear sitio desde una plantilla: aplica la plantilla de verdad", async ({ page }) => {
  const id = unique();
  await page.goto("/sitios/nuevo");
  await page.getByRole("radio", { name: /Desde una plantilla/ }).check();
  await page.getByLabel("Nombre del sitio").fill(`Plantilla ${id}`);
  await page.getByLabel("Dirección pública").fill(`plantilla-${id}`);

  // Sin plantilla elegida, no deja continuar.
  await page.getByRole("button", { name: "Crear sitio con esta plantilla" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Elige una plantilla" })).toBeVisible();

  await page.getByRole("button", { name: "Elegir esta plantilla" }).first().click();
  await expect(page.getByText(/^Elegida:/)).toBeVisible();
  await page.screenshot({ path: `../../docs/design/capturas/sitio/nuevo-plantilla-${test.info().project.name}.png`, fullPage: true });

  await page.getByRole("button", { name: "Crear sitio con esta plantilla" }).click();
  await expect(page).toHaveURL(/\/sitios\/[0-9a-f-]{36}/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: `Plantilla ${id}` }).first()).toBeVisible({ timeout: 30_000 });
  // De verdad aplicada: la página de inicio del sitio nuevo ya trae los bloques de la plantilla.
  const siteId = new URL(page.url()).pathname.split("/")[2]!;
  const base = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${siteId}`;
  const pages = (await (await page.request.get(`${base}/pages`)).json()) as Array<{ id: string; isHome: boolean }>;
  const home = pages.find((candidate) => candidate.isHome)!;
  const blocks = (await (await page.request.get(`${base}/pages/${home.id}/blocks`)).json()) as unknown[];
  expect(blocks.length).toBeGreaterThan(0);
});

test("crear sitio duplicando uno existente", async ({ page }) => {
  const id = unique();
  await page.goto("/sitios/nuevo");
  await page.getByRole("radio", { name: /Duplicar un sitio existente/ }).check();
  await page.getByLabel("Nombre del sitio").fill(`Copia ${id}`);
  await page.getByLabel("Dirección pública").fill(`copia-${id}`);
  await page.getByRole("button", { name: "Duplicar y crear sitio" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Elige el sitio" })).toBeVisible();
  await page.getByRole("radio", { name: new RegExp(fixture.siteSlug) }).check();
  await page.getByRole("button", { name: "Duplicar y crear sitio" }).click();
  await expect(page).toHaveURL(/\/sitios\/[0-9a-f-]{36}/, { timeout: 60_000 });
});
});
