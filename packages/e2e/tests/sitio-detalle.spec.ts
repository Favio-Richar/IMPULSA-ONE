import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// Extra F10 — detalle del sitio en pestañas y apariencia unificada (tema + fondo), en teléfono y escritorio: la pestaña activa vive
// en la URL, el teclado recorre las pestañas, la vista previa refleja tema y fondo a la vez ANTES de guardar, y «Aplicar apariencia»
// guarda ambos con una sola acción (o solo lo que cambió).

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/sitio-detalle";
const prisma = new PrismaClient();

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
});

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba (tema por defecto y fondo del tema).
  await prisma.$executeRaw`UPDATE sites SET theme_id = NULL, background = NULL WHERE id = ${fixture.siteId}::uuid`;
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, action: { in: ["site.theme_changed", "site.background_changed"] } } });
  await prisma.$disconnect();
});

test("las secciones están en pestañas y la activa vive en la URL", async ({ page }, testInfo) => {
  await page.goto(`/sitios/${fixture.siteId}`);
  const tablist = page.getByRole("tablist", { name: "Secciones del sitio" });
  await expect(tablist).toBeVisible({ timeout: 30_000 });
  await expect(tablist.getByRole("tab")).toHaveText(["Resumen", "Apariencia", "Páginas", "Comercio y reservas", "Contenido", "Dominio y medición"]);
  await expect(tablist.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
  // Resumen: «Mi sistema», datos del sitio y vistas.
  await expect(page.getByRole("form").or(page.getByText("Datos del sitio")).first()).toBeVisible();
  await expect(page.getByText("Datos del sitio")).toBeVisible();

  await tablist.getByRole("tab", { name: "Páginas" }).click();
  await expect(page).toHaveURL(/[?&]tab=paginas/);
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await expect(page.getByText("Datos del sitio")).toHaveCount(0);

  // Recargar conserva el lugar; un valor desconocido cae en Resumen.
  await page.reload();
  await expect(page.getByRole("tab", { name: "Páginas" })).toHaveAttribute("aria-selected", "true");
  await page.goto(`/sitios/${fixture.siteId}?tab=cualquier-cosa`);
  await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");

  // Teclado: flechas, Home y End mueven y activan.
  await page.getByRole("tab", { name: "Resumen" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Apariencia" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Apariencia" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Dominio y medición" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("form", { name: "Medición del sitio" })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");

  await expectNoHorizontalScroll(page);
  await capture(page, `01-resumen-${testInfo.project.name}.png`);

  // Cada grupo conserva sus accesos.
  await page.goto(`/sitios/${fixture.siteId}?tab=comercio`);
  await expect(page.getByRole("link", { name: "Administrar catálogo" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Administrar suscripción" })).toBeVisible();
  await page.goto(`/sitios/${fixture.siteId}?tab=contenido`);
  await expect(page.getByRole("link", { name: "Administrar tarjeta" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver campañas" })).toBeVisible();
});

test("la apariencia une tema y fondo en una vista previa en vivo y un solo botón", async ({ page }, testInfo) => {
  await page.goto(`/sitios/${fixture.siteId}?tab=apariencia`);
  const panel = page.getByRole("region", { name: "Apariencia", exact: true });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const preview = panel.getByRole("img", { name: "Vista previa de la apariencia" });
  await expect(preview).toHaveAttribute("data-device", "phone");
  const apply = panel.getByRole("button", { name: "Aplicar apariencia" });
  await expect(apply).toBeDisabled();

  // El tema elegido se ve en la vista previa antes de guardar.
  const before = await preview.locator("[data-site-root]").evaluate((element) => getComputedStyle(element).getPropertyValue("--site-color-primary"));
  await panel.getByRole("region", { name: "Vibrante" }).getByRole("button").first().click();
  await expect(panel.getByRole("button", { pressed: true }).first()).toBeVisible();
  await expect(apply).toBeEnabled();
  const afterTheme = await preview.locator("[data-site-root]").evaluate((element) => getComputedStyle(element).getPropertyValue("--site-color-primary"));
  expect(afterTheme).not.toBe(before);

  // El fondo elegido también, a la vez (sin guardar nada todavía).
  await panel.locator("label").filter({ has: page.getByRole("radio", { name: "Degradado", exact: true }) }).click();
  await expect(preview.locator('[data-background="gradient"]')).toBeVisible();
  const draftSite = await prisma.site.findUniqueOrThrow({ where: { id: fixture.siteId }, select: { themeId: true, background: true } });
  expect(draftSite.background).toBeNull();

  // Teléfono ↔ escritorio cambia el marco.
  await panel.getByRole("button", { name: "Escritorio" }).click();
  await expect(preview).toHaveAttribute("data-device", "desktop");
  await panel.getByRole("button", { name: "Teléfono" }).click();
  await expect(preview).toHaveAttribute("data-device", "phone");
  await expectNoHorizontalScroll(page);
  await capture(page, `02-apariencia-${testInfo.project.name}.png`);

  // Un solo clic aplica las dos cosas.
  await apply.click();
  await expect(panel.getByText("Apariencia aplicada. Ya se ve en tu página pública.")).toBeVisible({ timeout: 15_000 });
  const saved = await prisma.site.findUniqueOrThrow({ where: { id: fixture.siteId }, select: { themeId: true, background: true } });
  expect(saved.themeId).not.toBe(draftSite.themeId);
  expect(saved.background).toMatchObject({ kind: "gradient" });
  await expect(apply).toBeDisabled();
  await expect(panel.getByText("Actual").first()).toBeVisible();
});

test("si solo cambia uno de los dos, solo se aplica ese", async ({ page }) => {
  await page.goto(`/sitios/${fixture.siteId}?tab=apariencia`);
  const panel = page.getByRole("region", { name: "Apariencia", exact: true });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const before = await prisma.site.findUniqueOrThrow({ where: { id: fixture.siteId }, select: { themeId: true, background: true } });

  // Solo el fondo: del tema otra vez.
  await panel.locator("label").filter({ has: page.getByRole("radio", { name: "Del tema", exact: true }) }).click();
  await panel.getByRole("button", { name: "Aplicar apariencia" }).click();
  await expect(panel.getByText("Fondo aplicado. Ya se ve en tu página pública.")).toBeVisible({ timeout: 15_000 });
  const after = await prisma.site.findUniqueOrThrow({ where: { id: fixture.siteId }, select: { themeId: true, background: true } });
  expect(after.themeId).toBe(before.themeId);
  expect(after.background).toBeNull();
});

test("accesibilidad (axe, WCAG 2.2 AA) del detalle del sitio y de la apariencia", async ({ page }) => {
  const run = async (label: string): Promise<void> => {
    await page.waitForLoadState("networkidle");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return result.violations.map((violation) => ({ rule: violation.id, impact: violation.impact, nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) }));
    });
    expect(violations, `${label}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
  };
  for (const tab of ["resumen", "apariencia", "paginas", "comercio", "contenido", "dominio"]) {
    await page.goto(`/sitios/${fixture.siteId}?tab=${tab}`);
    await expect(page.getByRole("tab", { selected: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await run(`pestaña ${tab}`);
  }
});
