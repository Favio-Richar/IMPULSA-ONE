import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// Extra F10 — editor de temas propios, en teléfono y escritorio: duplicar y personalizar un tema del catálogo, ver el contraste AA
// de cada par EN VIVO (sin llegar nunca a un 422), guardar y aplicar al sitio, y eliminar (con el 409 del servidor cuando un
// sitio lo usa).

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/editor-temas";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
});

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba.
  await prisma.$executeRaw`UPDATE sites SET theme_id = NULL WHERE id = ${fixture.siteId}::uuid`;
  await prisma.theme.deleteMany({ where: { organizationId: fixture.organizationId, code: null } });
  await prisma.auditLog.deleteMany({
    where: { organizationId: fixture.organizationId, action: { in: ["theme.duplicated", "theme.updated", "theme.deleted", "site.theme_changed"] } },
  });
  await prisma.$disconnect();
});

test("duplicar y personalizar: el contraste se ve en vivo, guardar se bloquea con el motivo y al guardar queda aplicado", async ({ page }, testInfo) => {
  const name = `Mi tema ${suffix}-${testInfo.project.name}`;
  await page.goto(`/sitios/${fixture.siteId}?tab=apariencia`);
  const ejecutivo = page.getByRole("region", { name: "Ejecutivo" });
  await expect(ejecutivo).toBeVisible({ timeout: 30_000 });
  await ejecutivo.getByRole("button", { name: "Duplicar y personalizar Marino" }).click();

  const editor = page.getByRole("dialog", { name: "Personalizar tema" });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  // El tema duplicado nace válido: todo cumple y se puede guardar.
  await expect(editor.getByText("Todos los colores cumplen WCAG 2.2 AA.")).toBeVisible();
  const save = editor.getByRole("button", { name: "Guardar y aplicar" });
  await expect(save).toBeEnabled();
  await editor.getByLabel("Nombre del tema").fill(name);

  // Un texto secundario muy claro: el aviso trae la razón exacta y el botón se bloquea con el motivo.
  const muted = editor.getByLabel("Texto secundario", { exact: true });
  await muted.fill("#9ca3af");
  await expect(editor.getByTestId("state-Texto secundario")).toContainText(/No cumple AA: \d\.\d\d:1 \(necesita 4\.5:1\)/);
  await expect(save).toBeDisabled();
  await expect(editor.getByTestId("theme-block-reason")).toContainText(/Texto secundario sobre el fondo: \d\.\d\d:1 \(necesita 4\.5:1\)\./);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/01-contraste-${testInfo.project.name}.png`, fullPage: true });

  // Un hex a medias se explica; uno válido y legible lo vuelve a permitir.
  await muted.fill("#4b55");
  await expect(editor.getByText("Usa un color como #1d4ed8.")).toBeVisible();
  await expect(save).toBeDisabled();
  await muted.fill("#3f4a5a");
  await expect(editor.getByTestId("state-Texto secundario")).toContainText("Cumple AA");
  await expect(save).toBeEnabled();

  // Tipografía y forma: opciones visuales, no un <select>.
  // Los radios están ocultos visualmente dentro de su tarjeta: se elige haciendo clic en ella, como una persona.
  for (const option of [/Vibrante/, "Recto", "Contorno"]) {
    const query = typeof option === "string" ? { name: option, exact: true } : { name: option };
    // El radio dentro de `has` se busca relativo a la etiqueta: por eso se arma desde la página, no desde el diálogo.
    await editor.locator("label").filter({ has: page.getByRole("radio", query) }).click();
    await expect(editor.getByRole("radio", query)).toBeChecked();
  }

  await save.click();
  await expect(editor).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText("Tema aplicado. Ya se ve en tu página pública.")).toBeVisible();

  // Queda en «Tus temas», aplicado al sitio, con los tokens guardados.
  const own = page.getByRole("region", { name: "Tus temas" });
  await expect(own.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(own.getByText("Actual")).toBeVisible();
  const saved = await prisma.theme.findFirstOrThrow({ where: { organizationId: fixture.organizationId, name } });
  expect(saved.tokens).toMatchObject({ fontFamily: "vibrant", radius: "none", buttonStyle: "outline", palette: { mutedForeground: "#3f4a5a" } });
  const site = await prisma.site.findUniqueOrThrow({ where: { id: fixture.siteId }, select: { themeId: true } });
  expect(site.themeId).toBe(saved.id);
});

test("un tema en uso no se elimina (409 tal cual); aplicando otro, sí", async ({ page }) => {
  await page.goto(`/sitios/${fixture.siteId}?tab=apariencia`);
  const own = page.getByRole("region", { name: "Tus temas" });
  await expect(own).toBeVisible({ timeout: 30_000 });
  await own.getByRole("button", { name: /^Eliminar / }).first().click();
  const dialog = page.getByRole("dialog", { name: /^Eliminar «/ });
  await dialog.getByRole("button", { name: "Eliminar tema" }).click();
  // El mensaje es el del servidor: dice que algún sitio lo tiene aplicado.
  await expect(dialog.getByRole("alert")).toContainText(/sitio/i, { timeout: 10_000 });
  await dialog.getByRole("button", { name: "Cancelar" }).click();

  // Se aplica otro tema (borrador → «Aplicar apariencia») y entonces sí se puede eliminar.
  await page.getByRole("region", { name: "Minimal" }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Aplicar apariencia" }).click();
  await expect(page.getByText("Tema aplicado. Ya se ve en tu página pública.")).toBeVisible({ timeout: 15_000 });
  await own.getByRole("button", { name: /^Eliminar / }).first().click();
  await page.getByRole("dialog", { name: /^Eliminar «/ }).getByRole("button", { name: "Eliminar tema" }).click();
  await expect(page.getByRole("dialog", { name: /^Eliminar «/ })).toBeHidden({ timeout: 10_000 });
  expect(await prisma.theme.count({ where: { organizationId: fixture.organizationId, code: null } })).toBe(0);
});

test("accesibilidad (axe, WCAG 2.2 AA) del editor de temas abierto, en reposo y con un color que no cumple", async ({ page }) => {
  await page.goto(`/sitios/${fixture.siteId}?tab=apariencia`);
  await page.getByRole("region", { name: "Clásicos" }).getByRole("button", { name: /^Duplicar y personalizar / }).first().click();
  const editor = page.getByRole("dialog", { name: "Personalizar tema" });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addScriptTag({ content: axe.source });
  const audit = async (label: string, exclude: string[]): Promise<void> => {
    const violations = await page.evaluate(
      async ({ skip }) => {
        const result = await (window as unknown as { axe: typeof axe }).axe.run(skip.length ? { include: [["body"]], exclude: skip.map((selector) => [selector]) } : document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
        });
        return result.violations.map((violation) => ({ rule: violation.id, impact: violation.impact, nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) }));
      },
      { skip: exclude },
    );
    expect(violations, `${label}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
  };
  // En reposo (paleta válida): se audita todo, incluida la vista previa.
  await audit("editor en reposo", []);
  // Con un color malo: la vista previa lo MUESTRA a propósito (es su trabajo), así que solo ella queda fuera; el editor, no.
  await editor.getByLabel("Texto secundario", { exact: true }).fill("#9ca3af");
  await expect(editor.getByTestId("theme-block-reason")).toBeVisible();
  await audit("editor con un color que no cumple", ["[aria-label=\"Vista previa de la apariencia\"]"]);
  await editor.getByRole("button", { name: "Cancelar" }).click();
});
