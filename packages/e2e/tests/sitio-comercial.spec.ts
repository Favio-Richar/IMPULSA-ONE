import { expect, test, type Page } from "@playwright/test";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// Sitio comercial. ADR-009 — escena 3D del hero de la portada, en modo producción (`next start`). Afirma lo
// que el ADR exige: three.js fuera del paquete inicial, la escena no tapa ni bloquea el contenido,
// cuadro fijo con movimiento reducido, nada se desborda y ningún error en consola.

const HOME = `${PUBLIC_WEB_URL}/`;
const scene = (page: Page) => page.locator("[data-scene]");

async function hasWebGL2(page: Page): Promise<boolean> {
  return page.evaluate(() => document.createElement("canvas").getContext("webgl2") !== null);
}

/** Espera a que la escena termine de decidir (cargó, no aplica o falló) y devuelve el estado. */
async function settledScene(page: Page): Promise<string> {
  await expect(scene(page)).not.toHaveAttribute("data-scene", "pending", { timeout: 15_000 });
  return (await scene(page).getAttribute("data-scene")) ?? "";
}

// Huella de la librería three.js (su biblioteca de shaders), que no aparece en el código propio de la escena.
const THREE_FINGERPRINT = "#include <common>";

/** La parte del canvas que se ve en pantalla, por debajo de la cabecera fija. */
async function sceneClip(page: Page) {
  const box = await scene(page).locator("canvas").boundingBox();
  const viewport = page.viewportSize()!;
  const x = Math.max(0, box!.x);
  const y = Math.max(100, box!.y);
  return { x, y, width: Math.min(viewport.width, box!.x + box!.width) - x, height: Math.min(viewport.height, box!.y + box!.height) - y };
}

test("three.js no está en el paquete inicial: llega después, sin frenar el contenido", async ({ page }) => {
  const html = await (await page.request.get(HOME)).text();
  const initialScripts = new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => new URL(match[1]!, HOME).toString()));
  expect(initialScripts.size).toBeGreaterThan(0);
  for (const src of initialScripts) {
    const body = await (await page.request.get(src)).text();
    expect(body.includes(THREE_FINGERPRINT), `${src} trae three.js`).toBe(false);
  }

  // Y sí llega, en un archivo aparte, cuando la escena se carga.
  const threeChunks: string[] = [];
  page.on("response", async (response) => {
    if (response.request().resourceType() !== "script") return;
    const body = await response.text().catch(() => "");
    if (body.includes(THREE_FINGERPRINT)) threeChunks.push(response.url());
  });
  await page.goto(HOME);
  const state = await settledScene(page);
  test.skip(state === "off", "Sin WebGL 2 la escena no carga three.js.");
  await expect.poll(() => threeChunks.length).toBeGreaterThan(0);
  for (const url of threeChunks) {
    expect(initialScripts.has(url), url).toBe(false);
  }
});

test("la escena aparece detrás del hero sin tapar el texto ni los botones, y sin errores", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(HOME);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const state = await settledScene(page);
  if (await hasWebGL2(page)) {
    expect(state).toBe("animated");
    const box = await scene(page).locator("canvas").boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    expect(box?.height ?? 0).toBeGreaterThan(200);
  } else {
    expect(state).toBe("off");
  }

  // Decoración: oculta a lectores de pantalla y sin eventos de puntero.
  await expect(scene(page)).toHaveAttribute("aria-hidden", "true");
  expect(await scene(page).evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
  // El botón principal se puede tocar: nada lo cubre (`trial` comprueba que recibe el clic).
  await page.getByRole("link", { name: "Crear mi portal gratis" }).first().click({ trial: true });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("con movimiento reducido se pinta un cuadro fijo: la escena no se mueve", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(HOME);
  const state = await settledScene(page);
  test.skip(state === "off", "Sin WebGL 2 en este navegador no hay escena que comparar.");
  expect(state).toBe("static");

  await expect(scene(page)).toHaveCSS("opacity", "1");
  await scene(page).locator("canvas").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  const shot = await sceneClip(page);
  const first = await page.screenshot({ clip: shot });
  await page.mouse.move(40, 40);
  await page.waitForTimeout(800);
  await page.mouse.move(300, 500);
  expect((await page.screenshot({ clip: shot })).equals(first)).toBe(true);
});

test("la animación se pausa y se reanuda con un botón accesible por teclado (WCAG 2.2.2)", async ({ page }) => {
  await page.goto(HOME);
  const state = await settledScene(page);
  test.skip(state !== "animated", "Sin escena animada no hay nada que pausar.");

  const toggle = page.getByRole("button", { name: "Pausar la animación" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const box = await toggle.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await toggle.focus();
  await page.keyboard.press("Enter");
  const resume = page.getByRole("button", { name: "Reanudar la animación" });
  await expect(resume).toHaveAttribute("aria-pressed", "true");

  // El teléfono flota encima del canvas con una animación CSS (que ya respeta `prefers-reduced-motion`):
  // se congela para comparar solo la escena.
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; }" });
  // Recorte fijo del viewport, sin desplazar entre capturas: la captura de un elemento desplaza la
  // página y la cabecera fija puede quedar encima en una sola de ellas.
  const canvas = scene(page).locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  const shot = await sceneClip(page);
  const first = await page.screenshot({ clip: shot });
  await page.waitForTimeout(800);
  expect((await page.screenshot({ clip: shot })).equals(first)).toBe(true);

  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Pausar la animación" })).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(800);
  expect((await page.screenshot({ clip: shot })).equals(first)).toBe(false);
});

// Las tarjetas de plantilla pintan los bloques reales (que traen sus propios enlaces): envolverlas en
// otro `<a>` es HTML inválido y rompía la hidratación de la portada y de /plantillas.
for (const path of ["/", "/plantillas"]) {
  test(`${path}: tarjetas de plantilla sin enlaces anidados ni errores de hidratación, también con movimiento reducido`, async ({ page }) => {
    test.setTimeout(60_000);
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await test.step(`movimiento ${reducedMotion}`, async () => {
      const errors: string[] = [];
      const onConsole = (message: { type(): string; text(): string }) => {
        if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
      };
      page.on("console", onConsole);
      await page.emulateMedia({ reducedMotion });
      await page.goto(`${PUBLIC_WEB_URL}${path}`);
      // `load` y no `networkidle`: las miniaturas piden avatares a un servicio externo que no importa acá.
      await page.waitForLoadState("load");

      const cards = page.getByRole("link", { name: /^Usar la plantilla / });
      expect(await cards.count()).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.querySelectorAll("a a").length)).toBe(0);
      await cards.first().click({ trial: true });
      // Con teclado, la tarjeta muestra el foco (el enlace va superpuesto, el contorno tiene que verse).
      await cards.first().focus();
      expect(await cards.first().evaluate((link) => getComputedStyle(link).outlineStyle)).not.toBe("none");
      expect(errors, `${path} con movimiento ${reducedMotion}`).toEqual([]);
      page.off("console", onConsole);
      });
    }
  });
}
