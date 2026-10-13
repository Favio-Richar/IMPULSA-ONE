import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import type { SeededFixture } from "../global-setup.js";
import { FIXTURE_PATH } from "../global-setup.js";

// Menú lateral del panel (altura fija, secciones, modo de solo íconos) e inicio del propietario (resumen real).
// Escritorio y teléfono: el menú plegable solo existe en escritorio; en el teléfono sigue siendo el cajón.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = ".playwright/capturas/panel";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
});

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Inicio del propietario", () => {
  test("muestra el estado real del negocio, sus sitios, accesos y el equipo", async ({ page }, testInfo) => {
    await page.goto("/");
    const home = page.getByTestId("business-home");
    await expect(home).toBeVisible();
    await expect(home.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(home.getByRole("heading", { name: "Estado" })).toBeVisible();
    await expect(home.getByRole("heading", { name: "Tus sitios" })).toBeVisible();
    await expect(home.getByRole("heading", { name: "Accesos rápidos" })).toBeVisible();
    await expect(home.getByRole("heading", { name: "Equipo" })).toBeVisible();

    // El sitio sembrado aparece en la lista y lleva a su pantalla.
    await expect(home.locator(`a[href="/sitios/${fixture.siteId}"]`)).toBeVisible();
    // La tarjeta de sitios cuenta de verdad (no queda en «…» ni en «—»).
    await expect(home.getByRole("link", { name: /^Sitios\s*\d+/ })).toBeVisible();
    // La tabla de miembros sigue ahí, como una sección más.
    await expect(home.getByRole("columnheader", { name: "Correo" })).toBeVisible();

    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/inicio-${testInfo.project.name}.png`, fullPage: true });
  });
});

test.describe("Menú lateral", () => {
  test("agrupa los ítems por sección, con encabezados", async ({ page }, testInfo) => {
    await page.goto("/");
    if (testInfo.project.name === "movil") await page.getByRole("button", { name: "Abrir menú" }).click();
    const nav = page.getByRole("navigation", { name: "Navegación principal" }).filter({ visible: true }).first();
    for (const section of ["General", "Clientes", "Marketing", "Analítica", "Sistema"]) {
      await expect(nav.getByRole("group", { name: section })).toBeVisible();
    }
    // El filtrado no cambió: los mismos destinos siguen ahí y el activo se marca.
    await expect(nav.getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Catálogo" })).toBeVisible();
  });

  test("en escritorio queda fijo a la pantalla y solo su navegación se desplaza", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "escritorio", "El menú fijo es de escritorio.");
    await page.goto("/");
    const aside = page.locator("aside#panel-sidebar");
    await expect(aside).toBeVisible();
    // Se alarga la página para poder desplazarla.
    await page.evaluate(() => {
      const filler = document.createElement("div");
      filler.style.height = "3000px";
      document.querySelector("main")?.appendChild(filler);
    });
    const viewportHeight = page.viewportSize()!.height;
    const before = await aside.boundingBox();
    expect(Math.round(before!.height)).toBe(viewportHeight);

    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    const after = await aside.boundingBox();
    expect(Math.round(after!.y)).toBe(0);
    expect(Math.round(after!.height)).toBe(viewportHeight);

    // La zona de navegación tiene su propio desplazamiento, independiente del de la página.
    const scrollable = aside.locator("div.overflow-y-auto");
    expect(await scrollable.evaluate((node) => getComputedStyle(node).overflowY)).toBe("auto");
  });

  test("en escritorio se pliega a íconos, muestra el nombre al pasar y recuerda la preferencia", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "escritorio", "El pliegue es de escritorio.");
    await page.goto("/");
    const aside = page.locator("aside#panel-sidebar");
    await expect(aside).toHaveAttribute("data-collapsed", "false");
    const expandedWidth = (await aside.boundingBox())!.width;

    await page.getByRole("button", { name: "Contraer barra lateral" }).click();
    await expect(aside).toHaveAttribute("data-collapsed", "true");
    await expect.poll(async () => Math.round((await aside.boundingBox())!.width)).toBe(64);
    expect(expandedWidth).toBeGreaterThan(200);
    await expect(page.getByRole("button", { name: "Expandir barra lateral" })).toHaveAttribute("aria-expanded", "false");

    // El nombre sigue siendo accesible y aparece como tooltip al pasar el cursor.
    const sitios = aside.getByRole("link", { name: "Sitios" });
    await sitios.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Sitios");
    await page.screenshot({ path: `${CAPTURES}/menu-plegado.png` });

    // Sobrevive a una recarga (localStorage) y se puede volver a expandir.
    await page.reload();
    await expect(aside).toHaveAttribute("data-collapsed", "true");
    await page.getByRole("button", { name: "Expandir barra lateral" }).click();
    await expect(aside).toHaveAttribute("data-collapsed", "false");
    await expect.poll(async () => Math.round((await aside.boundingBox())!.width)).toBe(Math.round(expandedWidth));
  });

  test("en el teléfono no hay botón de plegar y el cajón se abre como antes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "movil", "Solo teléfono.");
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Contraer barra lateral" })).toBeHidden();
    await page.getByRole("button", { name: "Abrir menú" }).click();
    await expect(page.getByRole("navigation", { name: "Navegación principal" }).filter({ visible: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

// WCAG 2.2 AA (axe-core, reglas A y AA) del inicio y del menú, expandido y plegado.
async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((violation) => ({
      rule: violation.id,
      help: violation.help,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    }));
  });
  expect(violations, `${label}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
}

test.describe("Accesibilidad", () => {
  test("el inicio y el menú (expandido y plegado) no tienen violaciones AA", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByTestId("business-home")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Sitios\s*\d+/ })).toBeVisible();
    await expectNoAxeViolations(page, "inicio");
    if (testInfo.project.name === "escritorio") {
      await page.getByRole("button", { name: "Contraer barra lateral" }).click();
      await expect(page.locator("aside#panel-sidebar")).toHaveAttribute("data-collapsed", "true");
      await expectNoAxeViolations(page, "inicio con el menú plegado");
      await page.getByRole("button", { name: "Expandir barra lateral" }).click();
    }
  });
});
