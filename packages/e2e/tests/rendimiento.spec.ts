import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";
import { preparePublishedVideoPage } from "./support/published-page.js";

// PP7 — rendimiento de la página pública con video de fondo, en modo producción (`next start`) y con
// un teléfono en 4G emulado por Chrome: el preset "Slow 4G" de Lighthouse (150 ms de latencia,
// 1,6 Mbps de bajada, 750 kbps de subida) y la CPU 4 veces más lenta. Es el escenario más exigente
// de Lighthouse, no el promedio: si pasa acá, pasa en un teléfono real con 4G.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const LCP_BUDGET_MS = 2500;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.FFMPEG_PATH, "FFMPEG_PATH no configurado: sin video de fondo no hay escenario que medir.");

let api: APIRequestContext;
let cleanup: (() => Promise<void>) | null = null;

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(180_000);
  api = await playwright.request.newContext({ storageState: "./.playwright/session.json" });
  cleanup = await preparePublishedVideoPage(api, fixture);
});

test.afterAll(async () => {
  await cleanup?.();
  await api?.dispose();
});

/** LCP de la carga actual: la última entrada, una vez que la página dejó de cambiar. */
async function largestContentfulPaint(page: Page): Promise<{ time: number; element: string }> {
  return page.evaluate(
    () =>
      new Promise<{ time: number; element: string }>((resolve) => {
        let last: { time: number; element: string } = { time: 0, element: "" };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<PerformanceEntry & { element?: Element | null }>) {
            const element = entry.element;
            last = { time: entry.startTime, element: element ? `${element.tagName.toLowerCase()}${element.getAttribute("alt") === "" ? "[decorativa]" : ""}` : "" };
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => resolve(last), 1500);
      }),
  );
}

test("con video de fondo, en un teléfono con 4G lento, el LCP queda bajo 2,5 s y el video no lo frena", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "movil", "El presupuesto de LCP es del teléfono.");
  const url = `${PUBLIC_WEB_URL}/${fixture.siteSlug}`;
  // El servidor ya tiene la página en su caché de datos, como con cualquier perfil que recibe visitas.
  expect((await page.request.get(url)).status()).toBe(200);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const response = await page.goto(url, { waitUntil: "load" });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Estudio Aroma" })).toBeVisible();
  const lcp = await largestContentfulPaint(page);

  testInfo.annotations.push({ type: "LCP", description: `${Math.round(lcp.time)} ms (${lcp.element || "sin elemento"})` });
  console.log(`[PP7] LCP ${Math.round(lcp.time)} ms — elemento: ${lcp.element}`);
  expect(lcp.time).toBeGreaterThan(0);
  expect(lcp.time).toBeLessThan(LCP_BUDGET_MS);

  // El video llega después: el HTML inicial no trae ningún <video> (su URL solo viaja como dato
  // para React, que lo agrega tras cargar), así que primero se pinta el póster.
  const html = await (await page.request.get(url)).text();
  expect(html).not.toMatch(/<video[\s>]/);
  // Y no compite por la red con lo que decide el LCP: se pide recién después (misma base de tiempo).
  const videoStart = await page.evaluate(
    () => performance.getEntriesByType("resource").find((entry) => entry.name.endsWith("/video.mp4"))?.startTime ?? null,
  );
  console.log(`[PP7] el video se pidió a los ${videoStart === null ? "—" : Math.round(videoStart)} ms`);
  if (videoStart !== null) {
    expect(videoStart).toBeGreaterThanOrEqual(lcp.time);
  }

  await cdp.detach();
});
