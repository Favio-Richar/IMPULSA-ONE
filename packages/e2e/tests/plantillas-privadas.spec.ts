import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// F9.7c — plantillas privadas (ADR-028), en teléfono y escritorio: se guarda una página como plantilla propia desde el constructor,
// aparece en «Tus plantillas» al usar una plantilla, no está en la galería pública, y se puede borrar.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = ".playwright/capturas/f97";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const createdPageIds: string[] = [];

test.afterAll(async () => {
  await prisma.template.deleteMany({ where: { organizationId: fixture.organizationId, name: { contains: suffix } } });
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

test("guardar una página como plantilla propia, elegirla después y borrarla", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const templateName = `Base ${project} ${suffix}`;
  const owner = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  const orgPath = `${API_BASE_URL}/organizations/${fixture.organizationId}`;

  const created = await owner.post(`${orgPath}/sites/${fixture.siteId}/pages`, { data: { slug: `ptpl-${project}-${suffix}` } });
  expect(created.status()).toBe(201);
  const pageId = ((await created.json()) as { id: string }).id;
  createdPageIds.push(pageId);
  expect(
    (await owner.post(`${orgPath}/sites/${fixture.siteId}/pages/${pageId}/blocks`, { data: { type: "text", config: { html: "<p>Estructura base</p>", alignment: "left" } } })).status(),
  ).toBe(201);

  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto(`/sitios/${fixture.siteId}/paginas/${pageId}/editor`);

  // Guardar como plantilla: valida y confirma.
  await page.getByRole("button", { name: "Guardar como plantilla" }).click();
  const dialog = page.getByRole("dialog", { name: "Guardar como plantilla" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Guardar plantilla" })).toBeDisabled();
  await dialog.getByLabel("Nombre").fill(templateName);
  await dialog.getByLabel("Para qué sirve").fill("Estructura base para páginas de servicios");
  await expectNoHorizontalScroll(page);
  await capture(page, `05-plantilla-privada-guardar-${project}.png`);
  await dialog.getByRole("button", { name: "Guardar plantilla" }).click();
  await expect(dialog.getByTestId("template-saved")).toContainText(templateName);
  await dialog.getByRole("button", { name: "Listo" }).click();

  // Aparece en «Tus plantillas» al usar una plantilla, y no en la galería pública (sin sesión).
  await page.getByRole("button", { name: "Usar una plantilla" }).click();
  const section = page.getByTestId("private-templates");
  await expect(section).toBeVisible();
  const card = section.locator(`[data-template-name="${templateName}"]`);
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("De tu agencia");
  await expectNoHorizontalScroll(page);
  await capture(page, `06-plantilla-privada-lista-${project}.png`);
  const anonymous = await apiRequest.newContext();
  const publicTemplates = (await (await anonymous.get(`${API_BASE_URL}/templates`)).json()) as Array<{ name: string }>;
  expect(publicTemplates.map((template) => template.name)).not.toContain(templateName);
  await anonymous.dispose();

  // Elegirla lleva al paso de confirmación de siempre.
  await card.getByRole("button", { name: "Elegir" }).click();
  await expect(page.getByRole("dialog").getByText(`«${templateName}»`).first()).toBeVisible();
  await page.getByRole("button", { name: "Volver a las plantillas" }).click();

  // Borrarla.
  await card.getByRole("button", { name: "Borrar" }).click();
  await card.getByRole("button", { name: "Sí" }).click();
  await expect(card).toHaveCount(0);
  await owner.dispose();
});
