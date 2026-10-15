import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

// Paso 1 «Tipo de cuenta»: una sola pregunta con más opciones. Personal, Negocio y Agencia siempre a la vista; «Ver más opciones»
// despliega perfiles concretos que, al elegirlos, fijan el tipo de cuenta real y dejan el rubro elegido en el paso 3 (editable).
// También: el acento `info` solo en este paso y la aurora del fondo recortada cuando hay paneles laterales.

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const EMPTY_DRAFT = {
  accountType: null,
  accountOption: null,
  objective: null,
  industry: null,
  displayName: "",
  slug: "",
  socials: [],
  links: [],
  templateCode: null,
  headline: "",
  bio: "",
  whatsappPhone: "",
  primaryLinkLabel: "",
  primaryLinkUrl: "",
  secondaryObjectives: [],
  secondaryObjective: null,
  secondaryLinkLabel: "",
  secondaryLinkUrl: "",
};

async function startFresh(page: Page, draft: Record<string, unknown> = EMPTY_DRAFT, stepIndex = 0): Promise<void> {
  await page.goto("/bienvenida");
  await page.locator("h1").first().waitFor();
  await page.evaluate(
    ({ next, index }) => {
      const raw = sessionStorage.getItem("impulza-onboarding");
      if (!raw) throw new Error("No hay borrador del onboarding");
      const stored = JSON.parse(raw) as { state: Record<string, unknown> };
      stored.state.stepIndex = index;
      stored.state.draft = next;
      sessionStorage.setItem("impulza-onboarding", JSON.stringify(stored));
    },
    { next: draft, index: stepIndex },
  );
  await page.reload();
  await page.locator("h1").first().waitFor();
}

async function savedDraft(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => (JSON.parse(sessionStorage.getItem("impulza-onboarding")!) as { state: { draft: Record<string, unknown> } }).state.draft);
}

test("«Ver más opciones» despliega los perfiles en la misma pregunta; elegir uno guarda tipo de cuenta y rubro", async ({ page }) => {
  await startFresh(page);
  await expect(page.getByRole("heading", { level: 1, name: "Tipo de cuenta" })).toBeVisible();
  // De entrada, solo las tres de siempre.
  await expect(page.getByRole("radio")).toHaveCount(3);
  const toggle = page.getByRole("button", { name: /Ver más opciones \(9\)/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: "Menos opciones" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("radio")).toHaveCount(12);
  // El foco va a la primera opción nueva.
  await expect(page.getByRole("radio", { name: /Streamer y gaming/ })).toBeFocused();
  // Todas comparten el mismo nombre de grupo: es una sola respuesta.
  expect(new Set(await page.getByRole("radio").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).name)))).toEqual(new Set(["accountType"]));

  await page.getByRole("radio", { name: /Barbería y estética/ }).check();
  expect(await savedDraft(page)).toMatchObject({ accountOption: "barberia-estetica", accountType: "negocio", industry: "barberia-estetica" });
  // Con un perfil elegido no se puede plegar la lista (escondería la respuesta).
  await expect(page.getByRole("button", { name: /opciones/ })).toHaveCount(0);

  await page.getByRole("radio", { name: /Docente/ }).check();
  expect(await savedDraft(page)).toMatchObject({ accountOption: "docencia", accountType: "personal", industry: "docencia" });

  // Volver a una de las tres de siempre quita el rubro que había puesto el perfil.
  await page.getByRole("radio", { name: /Agencia/ }).check();
  expect(await savedDraft(page)).toMatchObject({ accountOption: "agencia", accountType: "agencia", industry: null });
});

test("el perfil deja su rubro preseleccionado en el paso 3, se puede cambiar, y sin perfil no hay preselección", async ({ page }) => {
  await startFresh(page);
  await page.getByRole("button", { name: /Ver más opciones/ }).click();
  await page.getByRole("radio", { name: /Fotografía y video/ }).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Objetivo principal" })).toBeVisible();
  await page.getByRole("radio", { name: /Mostrar mi trabajo/ }).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Industria" })).toBeVisible();
  const preset = page.getByRole("radio", { name: "Fotografía y video" });
  await expect(preset).toBeChecked();
  await expect(page.getByRole("button", { name: "Continuar" })).toBeEnabled();
  // Editable: se elige otro rubro y queda ese.
  await page.getByRole("radio", { name: "Creadores y artistas" }).check();
  await expect(preset).not.toBeChecked();
  expect(await savedDraft(page)).toMatchObject({ industry: "creador", accountType: "personal" });

  // Sin perfil (Negocio): el paso 3 llega sin nada elegido, como siempre.
  await startFresh(page);
  await page.getByRole("radio", { name: /Negocio/ }).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("radio", { name: /^Vender/ }).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Industria" })).toBeVisible();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();
});

test("un borrador viejo con un rubro que ya no existe se descarta en vez de romper la galería", async ({ page }) => {
  const stale = { ...EMPTY_DRAFT, accountType: "personal", objective: "compartir", industry: "redes-sociales" };
  // Paso 3: no queda nada marcado y hay que elegir de nuevo; lo elegido se guarda normal.
  await startFresh(page, stale, 2);
  await expect(page.getByRole("heading", { level: 1, name: "Industria" })).toBeVisible();
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();
  await page.getByRole("radio", { name: "Creadores y artistas" }).check();
  expect(await savedDraft(page)).toMatchObject({ industry: "creador" });

  // Paso 7: la galería carga plantillas en vez de pedirle a la API un rubro que rechazaría.
  await startFresh(page, { ...stale, displayName: "Prueba", slug: "prueba-rubro-viejo" }, 6);
  await expect(page.getByRole("heading", { level: 1, name: "Plantilla" })).toBeVisible();
  await expect(page.locator("li[data-template-code]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("No pudimos cargar las plantillas")).toHaveCount(0);
});

test("accesibilidad (axe, WCAG 2.2 AA) del paso 1 con todas las opciones desplegadas y un perfil elegido", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startFresh(page);
  await page.getByRole("button", { name: /Ver más opciones/ }).click();
  await page.getByRole("radio", { name: /Música y podcast/ }).check();
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((violation) => ({ rule: violation.id, nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) }));
  });
  expect(violations, JSON.stringify(violations, null, 1)).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("el acento `info` va solo en el paso 1 y la aurora no asoma junto a los paneles laterales", async ({ page }) => {
  test.skip(test.info().project.name === "movil", "El viewport móvil se fija por proyecto");
  const INFO = "rgb(14, 116, 144)";
  const headerIcon = page.locator("h1").first().locator("xpath=../..").locator("span[aria-hidden='true']").first();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1800, height: 900 });
  await startFresh(page);
  expect(await headerIcon.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(INFO);
  await page.getByRole("button", { name: /Ver más opciones/ }).click();
  await page.getByRole("radio", { name: /Docente/ }).check();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: "../../docs/design/capturas/onboarding/03-tipo-cuenta-1800.png", fullPage: true });
  await startFresh(page, { ...EMPTY_DRAFT, accountType: "personal", accountOption: "personal" }, 1);
  await expect(page.getByRole("heading", { level: 1, name: "Objetivo principal" })).toBeVisible();
  expect(await headerIcon.evaluate((el) => getComputedStyle(el).backgroundImage)).not.toContain(INFO);
  await page.screenshot({ path: "../../docs/design/capturas/onboarding/03-paso2-sin-cambio-1800.png" });

  // Con paneles (≥1700 px): la aurora se limita a la franja central y el círculo de abajo a la derecha baja su intensidad.
  const aurora = page.locator(".onb-aurora");
  const wide = await aurora.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left, top: box.top, right: window.innerWidth - box.right, blobB: getComputedStyle(el.querySelector(".onb-blob-b")!).opacity };
  });
  expect(wide.left).toBe(256);
  expect(wide.top).toBe(56);
  expect(wide.right).toBeGreaterThanOrEqual(256);
  expect(Number(wide.blobB)).toBeLessThan(0.3);

  // Sin paneles, el fondo queda exactamente como estaba.
  await page.setViewportSize({ width: 1440, height: 900 });
  const narrow = await aurora.evaluate((el) => ({ left: el.getBoundingClientRect().left, blobB: getComputedStyle(el.querySelector(".onb-blob-b")!).opacity }));
  expect(narrow).toEqual({ left: 0, blobB: "0.55" });
});
