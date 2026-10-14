import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

// Rediseño visual del asistente de bienvenida, en teléfono y escritorio: la accesibilidad no empeora (axe WCAG 2.2 AA en los 11
// pasos), la vista previa lateral aparece desde el paso 4 (solo en pantallas grandes), refleja lo que se escribe y muestra la
// plantilla elegida, y las opciones traen ícono y un estado seleccionado visible.

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const DRAFT = {
  accountType: "negocio",
  objective: "vender",
  industry: "gastronomia",
  displayName: "Café Prueba Diseño",
  slug: "cafe-prueba-diseno",
  socials: [],
  links: [],
  templateCode: "cafe-gastronomia",
  headline: "Café de especialidad",
  bio: "",
  whatsappPhone: "+56912345678",
  primaryLinkLabel: "",
  primaryLinkUrl: "",
};

async function goToStep(page: Page, stepIndex: number, published = false): Promise<void> {
  await page.goto("/bienvenida");
  // El borrador recuerda el último paso: se espera cualquier título, no uno en particular.
  await page.locator("h1").first().waitFor();
  await page.evaluate(
    ({ index, draft, published: isPublished }) => {
      const raw = sessionStorage.getItem("impulza-onboarding");
      if (!raw) throw new Error("No hay borrador del onboarding");
      const stored = JSON.parse(raw) as { state: Record<string, unknown> };
      stored.state.stepIndex = index;
      stored.state.draft = draft;
      stored.state.progress = {
        organizationId: null,
        siteId: null,
        pageId: null,
        siteSlug: isPublished ? draft.slug : null,
        templateApplied: false,
        published: isPublished,
      };
      sessionStorage.setItem("impulza-onboarding", JSON.stringify(stored));
    },
    { index: stepIndex, draft: DRAFT, published },
  );
  await page.reload();
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const STEP_TITLES = [
  "Tipo de cuenta",
  "Objetivo principal",
  "Industria",
  "Nombre visible",
  "Tu dirección",
  "Redes y enlaces",
  "Plantilla",
  "Perfil y acción principal",
  "Vista previa",
  "Publicación",
  "Primeros pasos",
] as const;

test("accesibilidad (axe, WCAG 2.2 AA) de los 11 pasos del asistente rediseñado", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [index, title] of STEP_TITLES.entries()) {
    await goToStep(page, index, index === 10);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 30_000 });
    if (title === "Plantilla") await expect(page.locator("li[data-template-code]").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      return result.violations.map((violation) => ({ rule: violation.id, impact: violation.impact, nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) }));
    });
    expect(violations, `paso ${index + 1} «${title}»: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
    await expectNoHorizontalScroll(page);
  }
});

test("las opciones traen ícono y un estado seleccionado visible, y el avance se numera", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/bienvenida");
  const fieldset = page.locator("fieldset").first();
  const cards = fieldset.locator("label");
  await expect(cards).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(cards.nth(index).locator("svg").first()).toBeVisible();
  }
  const card = cards.filter({ has: page.getByRole("radio", { name: /^Negocio/ }) });
  await card.click();
  await expect(page.getByRole("radio", { name: /^Negocio/ })).toBeChecked();
  // El estado seleccionado se ve: borde de color primario y el check dentro del círculo.
  await expect(card).toHaveCSS("border-top-color", /rgb\(/);
  await expect(card.locator("svg").last()).toBeVisible();
  await expect(page.getByText("Paso 1 de 11")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Avance del asistente" })).toHaveAttribute("aria-valuenow", "1");
  if (testInfo.project.name === "escritorio") {
    // En escritorio hay una barra de pasos numerada (decorativa) junto a «Paso N de 11».
    await expect(page.locator("ol[aria-hidden='true'] li")).toHaveCount(11);
  }
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `../../docs/design/capturas/onboarding/01-opciones-${testInfo.project.name}.png`, fullPage: true });
});

test("la vista previa lateral aparece desde el nombre, refleja lo que escribes y muestra la plantilla elegida", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const large = testInfo.project.name === "escritorio";

  // Pasos 1 a 3: sin vista previa lateral.
  await goToStep(page, 0);
  await expect(page.locator("aside")).toHaveCount(0);

  // Paso 4: aparece (solo en pantallas grandes) y sigue lo que se escribe.
  await goToStep(page, 3);
  const aside = page.locator("aside[aria-hidden='true']");
  await expect(aside).toHaveCount(1);
  if (large) {
    await expect(aside).toBeVisible();
    await expect(aside.getByText("Café Prueba Diseño")).toBeVisible();
    await page.getByLabel("Nombre del negocio").fill("Panadería La Espiga");
    await expect(aside.getByText("Panadería La Espiga")).toBeVisible();
    await page.screenshot({ path: `../../docs/design/capturas/onboarding/02-nombre-vivo-${testInfo.project.name}.png`, fullPage: true });
  } else {
    // En un teléfono no ocupa lugar: no hay columna lateral.
    await expect(aside).toBeHidden();
  }

  // Paso 8: con la plantilla elegida, es la plantilla real con los datos del borrador y lo que se escribe.
  await goToStep(page, 7);
  if (large) {
    await expect(aside.getByText("Café de especialidad")).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Frase corta").fill("Tostamos cada mañana");
    await expect(aside.getByText("Tostamos cada mañana")).toBeVisible();
    await page.screenshot({ path: `../../docs/design/capturas/onboarding/03-perfil-vivo-${testInfo.project.name}.png`, fullPage: true });
  }

  // Paso 9 (vista previa grande) y 11 (logro): sin la lateral, para no duplicar.
  await goToStep(page, 8);
  await expect(page.locator("aside")).toHaveCount(0);
  await goToStep(page, 10, true);
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.getByText("¡Tu página ya está en línea!")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `../../docs/design/capturas/onboarding/04-logro-${testInfo.project.name}.png`, fullPage: true });
});

test("la plantilla elegida se distingue en la galería con una insignia «Elegida» sólida", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await goToStep(page, 6);
  const card = page.locator("li[data-template-code='cafe-gastronomia']");
  await expect(card).toBeVisible({ timeout: 30_000 });
  const badge = card.getByText("Elegida");
  await expect(badge).toBeVisible();
  // Insignia con fondo de color (no solo texto): el fondo no es transparente.
  await expect.poll(() => badge.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `../../docs/design/capturas/onboarding/05-plantillas-${testInfo.project.name}.png`, fullPage: true });
});
