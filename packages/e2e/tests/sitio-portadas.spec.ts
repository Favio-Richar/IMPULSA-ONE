import { expect, test } from "@playwright/test";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// Portadas del sitio comercial (2026-09-30): el corredor de fotos de la home y el carrusel de rubros
// de /plantillas, contra el build de producción, en teléfono y escritorio.

test("home: el corredor está detrás del mensaje, es decorativo y se pausa con un botón (WCAG 2.2.2)", async ({ page }) => {
  await page.goto(`${PUBLIC_WEB_URL}/`);
  const hero = page.getByTestId("corridor-hero");
  await expect(hero.getByRole("heading", { level: 1 })).toContainText("Tu negocio, al frente.");
  await expect(hero.getByRole("link", { name: "Crear mi portal gratis" })).toBeVisible();
  // Las tarjetas del corredor no llegan a los lectores de pantalla.
  await expect(hero.locator("[aria-hidden]").first()).toBeAttached();

  const cards = hero.locator("[aria-hidden] img");
  expect(await cards.count()).toBeGreaterThan(10);
  const states = () => hero.locator("[aria-hidden] [class^='ish-c-']").evaluateAll((els) => els.map((el) => getComputedStyle(el).animationPlayState));

  const toggle = hero.getByRole("button", { name: "Pausar el movimiento" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(hero.getByRole("button", { name: "Reanudar el movimiento" })).toHaveAttribute("aria-pressed", "true");
  expect(new Set(await states())).toEqual(new Set(["paused"]));

  await hero.getByRole("button", { name: "Reanudar el movimiento" }).click();
  expect(new Set(await states())).toEqual(new Set(["running"]));
});

test("home: con movimiento reducido el corredor queda quieto", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${PUBLIC_WEB_URL}/`);
  const states = await page
    .getByTestId("corridor-hero")
    .locator("[aria-hidden] [class^='ish-c-']")
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationPlayState));
  expect(new Set(states)).toEqual(new Set(["paused"]));
});

test("plantillas: el carrusel cambia de rubro con botones y teclado, y no atrapa el scroll", async ({ page }) => {
  await page.goto(`${PUBLIC_WEB_URL}/plantillas`);
  const carousel = page.getByRole("group", { name: "Plantillas por rubro" });
  const title = (name: string) => carousel.getByRole("heading", { level: 2, name });
  // El título que sale se desvanece un instante: se busca por nombre (accesible y con espacio).
  await expect(title("Barberías y peluquerías")).toBeVisible();
  await expect(carousel.getByRole("button", { name: "Anterior" })).toBeDisabled();

  await carousel.getByRole("button", { name: "Siguiente" }).click();
  await expect(title("Cafés y restaurantes")).toBeVisible();
  await expect(carousel.getByRole("button", { name: /^Cafés y restaurantes$/ })).toHaveAttribute("aria-current", "true");

  await carousel.focus();
  await page.keyboard.press("End");
  await expect(title("Portafolios y creativos")).toBeVisible();
  await expect(carousel.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  await page.keyboard.press("Home");
  await expect(title("Barberías y peluquerías")).toBeVisible();

  // La rueda sobre el carrusel desplaza la página (no la retiene).
  const box = (await carousel.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  await expect(title("Barberías y peluquerías")).toBeAttached();

  await expect(carousel.getByRole("link", { name: "Crear mi portal gratis" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
