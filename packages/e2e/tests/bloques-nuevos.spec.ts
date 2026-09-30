import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F7.3 (ADR-018) — bloques nuevos de punta a punta. En el constructor: agregar una cuenta regresiva y
// una música, con el rechazo del código de inserción junto al campo. En la página publicada (build
// de producción, con su CSP): el conteo corre, los precios se formatean, el mapa **no** llama a
// Google hasta que se pide, la música y el TikTok salen de sus plantillas, los eventos pasados se
// ocultan y cada evento trae su calendario y sus datos para buscadores. Los reproductores externos
// se sirven con respuestas de prueba: nada sale a internet.

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const CAPTURES = ".playwright/capturas/f73";
const EMBEDS = /open\.spotify\.com|w\.soundcloud\.com|embed\.music\.apple\.com|www\.tiktok\.com|www\.google\.com\/maps/;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Fecha y hora de pared en Santiago dentro de `days` días (negativo = pasado). */
function santiago(days: number, hour: number): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * 86_400_000));
  return `${day}T${String(hour).padStart(2, "0")}:00`;
}

async function blockIds(api: APIRequestContext): Promise<string[]> {
  return ((await (await api.get(blocksPath)).json()) as Array<{ id: string }>).map((block) => block.id);
}

test("en el constructor se agregan una cuenta regresiva y una música; el código de inserción se rechaza junto al campo", async ({ page }, testInfo) => {
  const before = new Set(await blockIds(page.request));
  try {
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    const library = page.getByRole("region", { name: "Biblioteca de bloques" });
    const panel = page.getByRole("region", { name: "Configuración del bloque" });

    await library.getByRole("button", { name: "Cuenta regresiva" }).click();
    await expect(panel.getByLabel("Termina el")).toHaveValue(/^\d{4}-\d{2}-\d{2}T20:00$/);
    await expect(panel.getByLabel("Zona horaria")).toHaveValue("America/Santiago");
    // La vista previa ya cuenta (hidratada): cifras, no guiones.
    const preview = page.locator("[data-site-root] [data-countdown]").first();
    await expect(preview.locator('[data-countdown-value="days"]')).toHaveText(/^\d+$/);
    await panel.getByLabel("Título").fill("Gran apertura");
    await expect(panel.getByText("Guardado")).toBeVisible({ timeout: 15_000 });
    await expect(preview).toContainText("Gran apertura");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/constructor-cuenta-${testInfo.project.name}.png` });

    await library.getByRole("button", { name: "Música" }).click();
    const music = panel.getByLabel("Canción, álbum o lista");
    await music.fill('<iframe src="https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC"></iframe>');
    await expect(panel.getByRole("alert").filter({ hasText: "no el código de inserción" })).toBeVisible();
    await music.fill("https://evil.example.com/cancion");
    await expect(panel.getByRole("alert").filter({ hasText: "Spotify, SoundCloud o Apple Music" })).toBeVisible();
    const saved = page.waitForResponse((response) => response.url().includes("/blocks/") && response.request().method() === "PATCH" && response.status() === 200);
    await music.fill("https://open.spotify.com/intl-es/track/4uLU6hMCjMI75M1A2tKUQC?si=abc");
    await saved;
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(page.locator('[data-site-root] [data-music="spotify"] iframe')).toHaveAttribute("src", "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC?utm_source=generator");
    await page.screenshot({ path: `${CAPTURES}/constructor-musica-${testInfo.project.name}.png` });
  } finally {
    for (const id of await blockIds(page.request)) {
      if (!before.has(id)) await page.request.delete(`${blocksPath}/${id}`, { headers: CSRF });
    }
  }
});

test.describe("página publicada", () => {
  let api: APIRequestContext;
  const created: string[] = [];

  async function revalidate(): Promise<void> {
    const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, { headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET }, data: { siteSlug: fixture.siteSlug } });
    expect(response.status()).toBe(200);
  }

  test.beforeAll(async () => {
    api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
    const blocks: Array<{ type: string; config: unknown }> = [
      { type: "countdown", config: { title: "Apertura de temporada", target: santiago(10, 20), timeZone: "America/Santiago", cta: { label: "Quiero ir", url: "https://ejemplo.cl/ir" } } },
      {
        type: "pricing",
        config: {
          title: "Planes",
          plans: [
            { name: "Básico", priceAmount: 19_990, period: "month", features: ["Una clase a la semana", "Acceso a la sala"] },
            { name: "Completo", priceAmount: 39_990, period: "month", features: ["Clases ilimitadas", "Plan de nutrición"], badge: "Más elegido", highlighted: true, cta: { label: "Elegir", url: "https://ejemplo.cl/completo" } },
          ],
        },
      },
      { type: "map", config: { name: "Estudio Aroma", address: "Av. Providencia 1234, Providencia, Santiago", note: "Estacionamiento en el subterráneo" } },
      { type: "music", config: { music: "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3", title: "Nuestra lista" } },
      {
        type: "events",
        config: {
          title: "Próximas fechas",
          timeZone: "America/Santiago",
          items: [
            { name: "Taller ya realizado", start: santiago(-3, 10) },
            { name: "Cata de café", start: santiago(5, 19), end: santiago(5, 21), venue: "Estudio Aroma", ticketUrl: "https://ejemplo.cl/entradas" },
          ],
        },
      },
      { type: "video", config: { video: "https://www.tiktok.com/@estudio/video/7312345678901234567" } },
    ];
    for (const block of blocks) {
      const response = await api.post(blocksPath, { headers: CSRF, data: block });
      expect(response.status(), await response.text()).toBe(201);
      created.push(((await response.json()) as { id: string }).id);
    }
    expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
    await revalidate();
  });

  test.afterAll(async () => {
    for (const id of created) await api.delete(`${blocksPath}/${id}`, { headers: CSRF });
    await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
    await revalidate();
    await api.dispose();
  });

  test("los bloques se ven y funcionan, el mapa no llama a Google sin pedirlo y la CSP no bloquea nada", async ({ browser, viewport }, testInfo) => {
    const context = await browser.newContext({ viewport: viewport!, locale: "es-CL" });
    const external: string[] = [];
    // Respuestas de prueba para los reproductores: se afirma qué se pide, sin salir a internet.
    await context.route(EMBEDS, (route) => {
      external.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>reproductor de prueba</title>" });
    });
    await context.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    const page = await context.newPage();
    try {
      await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);

      const countdown = page.locator("[data-countdown]");
      await expect(countdown).toContainText("Apertura de temporada");
      await expect(countdown.locator('[data-countdown-value="days"]')).toHaveText(/^(9|10)$/);
      await expect(countdown.getByRole("timer")).toHaveAttribute("aria-label", /^Faltan \d+ días/);
      const first = await countdown.locator('[data-countdown-value="seconds"]').textContent();
      await expect.poll(async () => countdown.locator('[data-countdown-value="seconds"]').textContent(), { timeout: 5_000 }).not.toBe(first);

      const plans = page.locator("[data-pricing-plan]");
      await expect(plans).toHaveCount(2);
      await expect(plans.nth(0)).toContainText("$19.990");
      await expect(plans.nth(1)).toContainText("Más elegido");
      await expect(page.locator("[data-highlighted]").getByRole("link", { name: "Elegir" })).toHaveAttribute("href", "https://ejemplo.cl/completo");

      const map = page.locator("[data-map]");
      await expect(map.locator("address")).toHaveText("Av. Providencia 1234, Providencia, Santiago");
      await expect(map.getByRole("link", { name: "Cómo llegar" })).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&destination=Av\.%20Providencia/);
      await expect(map.locator("iframe")).toHaveCount(0);

      await expect(page.locator('[data-music="spotify"] iframe')).toHaveAttribute("src", /^https:\/\/open\.spotify\.com\/embed\/album\/1DFixLWuPkv3KT3TnV35m3/);
      await expect(page.locator('iframe[src^="https://www.tiktok.com/player/v1/7312345678901234567"]')).toBeAttached();

      const events = page.locator("[data-events]");
      await expect(events.locator("[data-event]")).toHaveCount(1);
      await expect(events).not.toContainText("Taller ya realizado");
      await expect(events).toContainText("Cata de café");
      await expect(events.getByRole("link", { name: "Agregar a mi calendario" })).toHaveAttribute("download", "cata-de-café.ics");
      const jsonLd = JSON.parse((await events.locator('script[type="application/ld+json"]').textContent())!) as Array<{ "@type": string; name: string }>;
      expect(jsonLd.map((event) => event.name)).toEqual(["Taller ya realizado", "Cata de café"]);

      await expectNoHorizontalScroll(page);
      expect(external.some((url) => url.includes("google.com/maps"))).toBe(false);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.screenshot({ path: `${CAPTURES}/pagina-${testInfo.project.name}.png`, fullPage: true });

      // Solo al pedirlo se carga el mapa.
      await map.getByRole("button", { name: "Ver mapa" }).click();
      await expect(map.locator("iframe")).toHaveAttribute("src", /^https:\/\/www\.google\.com\/maps\?q=Av\.%20Providencia/);
      await expect.poll(() => external.some((url) => url.includes("google.com/maps"))).toBe(true);
      await map.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${CAPTURES}/mapa-${testInfo.project.name}.png` });

      expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
