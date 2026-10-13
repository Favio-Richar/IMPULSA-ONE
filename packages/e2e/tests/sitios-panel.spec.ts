import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// Extra F10 — vista «Sitios» como panel de control, en teléfono y escritorio: tarjetas con portada del tema, enlace público con
// copiar, estado de dominio, QR, visitas de 30 días, uso del plan, orden, y duplicar sitio de punta a punta (la copia nace en
// borrador, el error de slug en uso se explica y, en el límite del plan, «Crear sitio» queda bloqueado con su motivo).

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/sitios-panel";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const COPY_SLUG = `copia-${suffix}`;
let previousPlanId: string | null = null;
let copyId: string | null = null;
let publicUrl = "";

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

test.beforeAll(async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } });
  previousPlanId = org.planId;
  // Plan con cupo: esta prueba verifica la vista y el duplicado, no el límite (el límite se prueba abajo con el plan Gratis).
  const roomy = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: roomy.id } });
});

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba.
  const copies = await prisma.site.findMany({ where: { organizationId: fixture.organizationId, id: { not: fixture.siteId } }, select: { id: true, slug: true } });
  for (const copy of copies) {
    if (copy.slug.startsWith("copia-") || copy.id === copyId) await prisma.site.delete({ where: { id: copy.id } });
  }
  if (publicUrl) await prisma.qrCode.deleteMany({ where: { organizationId: fixture.organizationId, directUrl: publicUrl } });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, action: "site.duplicated" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId } });
  await prisma.$disconnect();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
});

test("la vista muestra tarjetas con portada, enlace, dominio, visitas y uso del plan", async ({ page }, testInfo) => {
  await page.goto("/sitios");
  const card = page.getByRole("article").first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Sitios", exact: true })).toBeVisible();
  await expect(card.getByTestId("site-cover")).toBeVisible();
  await expect(card.getByText(/localhost:\d+\/e2e-|\/sitio-/).first()).toBeVisible();
  await expect(card.getByText("Sin dominio propio")).toBeVisible();
  await expect(card.getByRole("link", { name: "Configurar dominio" })).toHaveAttribute("href", /#dominio-propio$/);
  await expect(card.getByTestId("site-visits")).toBeVisible();
  await expect(page.getByRole("region", { name: "Uso del plan" })).toContainText(/de 50 sitios usados|sitios usados/);
  await expect(page.getByRole("progressbar", { name: "Sitios usados" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `01-vista-${testInfo.project.name}.png`);
});

test("copiar el enlace confirma con un check y el orden se puede cambiar", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await page.goto("/sitios");
  const card = page.getByRole("article").first();
  await card.getByRole("button", { name: /Copiar el enlace de/ }).click();
  await expect(card.getByRole("button", { name: "Enlace copiado" })).toBeVisible();

  const sort = page.getByLabel("Ordenar por");
  await expect(sort.locator("option")).toHaveText(["Más reciente", "Más visitas", "Nombre (A–Z)"]);
  await sort.selectOption("visits");
  await expect(sort).toHaveValue("visits");
  await expect(page.getByRole("article").first()).toBeVisible();
});

test("el QR se genera en un modal con descarga y se reutiliza al volver a abrirlo", async ({ page }) => {
  await page.goto("/sitios");
  const card = page.getByRole("article").first();
  const href = await card.getByRole("button", { name: /Copiar el enlace de/ }).getAttribute("aria-label");
  expect(href).toBeTruthy();
  await card.getByRole("button", { name: "Generar QR" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Todavía no tienes un código QR/)).toBeVisible();
  await dialog.getByRole("button", { name: "Generar QR" }).click();
  await expect(dialog.getByRole("img", { name: /Código QR hacia/ })).toBeVisible();
  publicUrl = (await dialog.locator("p.break-all").innerText()).trim();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Descargar PNG" }).click();
  expect((await download).suggestedFilename()).toMatch(/^qr-.*\.png$/);
  await page.keyboard.press("Escape");

  // Al volver a abrirlo no crea otro: muestra el que ya existe.
  await card.getByRole("button", { name: "Generar QR" }).click();
  await expect(page.getByRole("dialog").getByRole("img", { name: /Código QR hacia/ })).toBeVisible();
  expect(await prisma.qrCode.count({ where: { organizationId: fixture.organizationId, directUrl: publicUrl } })).toBe(1);
  await page.keyboard.press("Escape");
});

test("duplicar: el slug en uso se explica; con uno libre la copia nace en borrador y se abre", async ({ page }, testInfo) => {
  await page.goto("/sitios");
  const card = page.getByRole("article").first();
  const originalSlugText = fixture.siteSlug;

  await card.getByRole("button", { name: /Acciones de/ }).click();
  await page.getByRole("button", { name: "Duplicar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Nombre de la copia")).toHaveValue(/^Copia de /);
  await expect(dialog.getByLabel("Identificador público")).toHaveValue(new RegExp(`^${originalSlugText}-copia`));
  await capture(page, `02-duplicar-${testInfo.project.name}.png`);

  // Slug de otro sitio: error claro junto al campo, sin cerrar el diálogo.
  await dialog.getByLabel("Identificador público").fill(originalSlugText);
  await dialog.getByRole("button", { name: "Duplicar sitio" }).click();
  await expect(dialog.getByText("Ese identificador ya lo usa uno de tus sitios.")).toBeVisible();

  // Con uno libre: se crea y se navega a la copia.
  await dialog.getByLabel("Nombre de la copia").fill(`Copia e2e ${suffix} ${testInfo.project.name}`);
  const slug = `${COPY_SLUG}-${testInfo.project.name}`;
  await dialog.getByLabel("Identificador público").fill(slug);
  await dialog.getByRole("button", { name: "Duplicar sitio" }).click();
  await expect(page).toHaveURL(/\/sitios\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  const created = await prisma.site.findUniqueOrThrow({ where: { slug }, include: { pages: true } });
  copyId = created.id;
  expect(created.status).toBe("DRAFT");
  expect(created.organizationId).toBe(fixture.organizationId);
  expect(created.pages.some((entry) => entry.isHome)).toBe(true);
  expect(await prisma.siteDomain.count({ where: { siteId: created.id } })).toBe(0);
  await prisma.site.delete({ where: { id: created.id } });
  copyId = null;
});

test("accesibilidad (axe, WCAG 2.2 AA) de la vista de sitios y de su diálogo de duplicar", async ({ page }) => {
  await page.goto("/sitios");
  await expect(page.getByRole("article").first()).toBeVisible({ timeout: 30_000 });
  const run = async (label: string): Promise<void> => {
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return result.violations.map((violation) => ({ rule: violation.id, impact: violation.impact, nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) }));
    });
    expect(violations, `${label}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForLoadState("networkidle");
  await run("vista de sitios");
  await page.getByRole("article").first().getByRole("button", { name: /Acciones de/ }).click();
  await run("menú de acciones abierto");
  await page.getByRole("button", { name: "Duplicar" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await run("diálogo de duplicar");
});

test("en el límite del plan, crear sitio queda bloqueado con el motivo a la vista", async ({ page }, testInfo) => {
  const free = await prisma.plan.findUniqueOrThrow({ where: { code: "free" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: free.id } });
  try {
    const sites = await prisma.site.count({ where: { organizationId: fixture.organizationId, status: { not: "ARCHIVED" } } });
    expect(sites).toBeGreaterThanOrEqual(1);
    await page.goto("/sitios");
    await expect(page.getByRole("article").first()).toBeVisible({ timeout: 30_000 });
    const create = page.getByRole("button", { name: "Crear sitio" });
    await expect(create).toBeDisabled();
    await expect(page.getByRole("region", { name: "Uso del plan" })).toContainText("Llegaste al límite de sitios");
    // El motivo existe como tooltip accesible asociado al botón bloqueado.
    const wrapper = create.locator("xpath=..");
    const tooltip = wrapper.getByRole("tooltip", { includeHidden: true });
    await expect(tooltip).toBeAttached();
    await expect(tooltip).toContainText("Llegaste al límite de 1 sitio");
    // Aparece al enfocar el botón bloqueado (el contenedor es el enfocable).
    await wrapper.focus();
    await expect(tooltip).toBeVisible();
    await expect(page.getByRole("link", { name: "Crear sitio" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await capture(page, `03-limite-${testInfo.project.name}.png`);
  } finally {
    const roomy = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
    await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: roomy.id } });
  }
});

test("sin sitios muestra el estado vacío con su ilustración y, si la lista falla, el error con reintentar", async ({ page }, testInfo) => {
  await page.route("**/organizations/*/sites", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    return route.continue();
  });
  await page.goto("/sitios");
  await expect(page.getByRole("heading", { name: "Todavía no tienes ningún sitio" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("img", { name: "Ilustración de un portal vacío" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Crear con una plantilla" }).last()).toBeVisible();
  await expect(page.getByRole("link", { name: "Empezar de cero" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `04-vacio-${testInfo.project.name}.png`);
});

test("si la API de sitios falla, se ofrece reintentar en vez de una pantalla rota", async ({ page }) => {
  await page.route("**/organizations/*/sites", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    return route.continue();
  });
  await page.goto("/sitios");
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible({ timeout: 30_000 });
});
