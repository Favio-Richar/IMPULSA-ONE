import { expect, test, type Page } from "@playwright/test";

// F8.2 (ADR-027) — transiciones del onboarding, y F8.4 — el rubro nuevo «Educación y talleres».
// - Al cambiar de paso, el foco va al título (con o sin movimiento reducido).
// - El paso entrante usa `motion-fade` solo sin `reduce`; con `reduce` el cambio es instantáneo y los
//   pasos siguen funcionando.
// - El paso de plantilla escalona la entrada de las tarjetas (60 ms × índice, tope 8) y, filtrado por el
//   rubro nuevo, muestra «Academia y talleres».

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

async function settleAnimations(page: Page): Promise<void> {
  // Solo las finitas: una animación infinita (p. ej. un indicador de carga) nunca «termina».
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function openOnboarding(page: Page): Promise<void> {
  await page.goto("/bienvenida");
  await expect(page.getByRole("heading", { level: 1, name: "Tipo de cuenta" })).toBeVisible();
}

async function choose(page: Page, label: string): Promise<void> {
  await page.getByRole("radio", { name: label }).check();
}

for (const motion of ["no-preference", "reduce"] as const) {
  test(`F8.2 onboarding con movimiento ${motion === "reduce" ? "reducido" : "normal"}: el foco va al título y el paso ${motion === "reduce" ? "cambia sin animación" : "entra con fundido"}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: motion });
    await openOnboarding(page);

    const section = page.locator("section[aria-label='Tipo de cuenta']");
    await expect(section).toHaveCSS("animation-name", motion === "reduce" ? "none" : "impulza-fade");

    // Paso 1 → 2: elegir y continuar. El título nuevo recibe el foco.
    await page.locator("fieldset input[type='radio']").first().check();
    await page.getByRole("button", { name: "Continuar" }).click();
    const heading = page.getByRole("heading", { level: 1, name: "Objetivo principal" });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.locator("section[aria-label='Objetivo principal']")).toHaveCSS("animation-name", motion === "reduce" ? "none" : "impulza-fade");

    // Atrás también mueve el foco al título del paso al que se vuelve.
    await page.getByRole("button", { name: "Atrás" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tipo de cuenta" })).toBeFocused();

    // La barra de progreso sigue el paso.
    await expect(page.getByRole("progressbar", { name: "Avance del asistente" })).toHaveAttribute("aria-valuenow", "1");
    await expectNoHorizontalScroll(page);
    await settleAnimations(page);
    await page.screenshot({ path: `.playwright/capturas/f82/onboarding-${motion}-${testInfo.project.name}.png` });
  });
}

test("F8.4 onboarding: el rubro «Educación y talleres» existe y la galería muestra «Academia y talleres»", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openOnboarding(page);
  await choose(page, "Personal o marca personal");
  await page.getByRole("button", { name: "Continuar" }).click();
  await choose(page, "Captar clientes");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Industria" })).toBeFocused();
  await choose(page, "Educación y talleres");
  await page.getByRole("button", { name: "Continuar" }).click();

  // Se salta a la galería (paso 7) con el borrador ya guardado; el dueño del borrador es el mismo.
  await page.evaluate(() => {
    const raw = sessionStorage.getItem("impulza-onboarding");
    if (!raw) throw new Error("No hay borrador del onboarding");
    const stored = JSON.parse(raw) as { state: { stepIndex: number } };
    stored.state.stepIndex = 6;
    sessionStorage.setItem("impulza-onboarding", JSON.stringify(stored));
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Plantilla" })).toBeVisible();

  // Filtrada por el rubro nuevo, la galería ofrece la plantilla de academia.
  const academia = page.locator("li[data-template-code='academia-talleres']");
  await expect(academia.getByRole("heading", { name: "Academia y talleres" })).toBeVisible();

  // Las tarjetas entran escalonadas: 60 ms por posición, con tope en 8.
  const cards = page.getByRole("list", { name: "Plantillas" }).locator("> li");
  const total = await cards.count();
  expect(total).toBeGreaterThanOrEqual(1);
  for (let index = 0; index < Math.min(total, 10); index += 1) {
    const delayMs = await cards.nth(index).evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDelay) * 1000);
    expect(delayMs).toBeCloseTo(Math.min(index, 8) * 60, 0);
  }
  await expectNoHorizontalScroll(page);
  await settleAnimations(page);
  await page.screenshot({ path: `.playwright/capturas/f84/onboarding-educacion-${testInfo.project.name}.png` });
});
