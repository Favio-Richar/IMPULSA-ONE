import { readFileSync } from "node:fs";
import { expect, test, type BrowserContextOptions } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// F10.5 (ADR-029) — app instalable: manifiestos válidos con íconos, service worker que NUNCA guarda respuestas de la API ni páginas con
// datos, pantalla «sin conexión» y actualización controlada. El registro del service worker solo ocurre en producción, así que esa parte
// se ejerce contra el sitio público (build de producción); del panel (servidor de desarrollo) se verifica lo que entrega.

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
}

function expectInstallable(manifest: Manifest): void {
  expect(manifest.display).toBe("standalone");
  expect(manifest.name.length).toBeGreaterThan(0);
  expect(manifest.short_name.length).toBeGreaterThan(0);
  expect(manifest.start_url.startsWith(manifest.scope.replace(/\/$/, ""))).toBe(true);
  expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  const sizes = manifest.icons.map((icon) => icon.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
}

test("el panel entrega su manifiesto, íconos, pantalla sin conexión y un service worker sin caché de datos", async ({ request, baseURL }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as Manifest;
  expectInstallable(manifest);
  expect(manifest.start_url).toBe("/");

  for (const icon of manifest.icons) {
    const file = await request.get(icon.src);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toContain("image/png");
  }

  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-type"]).toContain("javascript");
  expect(worker.headers()["cache-control"]).toContain("no-store");
  expect(worker.headers()["service-worker-allowed"]).toBe("/");
  const source = await worker.text();
  // La regla de oro: la API y las peticiones que no son GET no se atienden, y la versión nueva no se activa sola.
  expect(source).toContain('"/api/"');
  expect(source).toContain('request.method !== "GET"');
  expect(source).toContain("SKIP_WAITING");
  const install = source.slice(source.indexOf('addEventListener("install"'), source.indexOf('addEventListener("message"'));
  expect(install).not.toContain("skipWaiting(");

  const offline = await request.get("/offline.html");
  expect(offline.status()).toBe(200);
  expect(await offline.text()).toContain("Sin conexión");
  expect(baseURL).toBeTruthy();
});

test("el sitio público: manifiesto propio, service worker activo, nada de la API en la caché y pantalla sin conexión", async ({ browser }, testInfo) => {
  const use = testInfo.project.use as BrowserContextOptions;
  const context = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
  const page = await context.newPage();

  // Manifiesto del sitio, enlazado desde la página.
  await page.goto(`/${fixture.siteSlug}`);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", `/${fixture.siteSlug}/manifest.webmanifest`);
  const manifestResponse = await page.request.get(`/${fixture.siteSlug}/manifest.webmanifest`);
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toContain("manifest+json");
  const manifest = (await manifestResponse.json()) as Manifest;
  expectInstallable(manifest);
  expect(manifest.scope).toBe(`/${fixture.siteSlug}/`);
  expect((await page.request.get(`/sitio-que-no-existe-pwa/manifest.webmanifest`)).status()).toBe(404);

  // Service worker: se instala, toma el control y guarda solo lo estático.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 }).toBe(true);

  // Una petición a nuestra API propia pasa por la página: no debe quedar en ninguna caché.
  await page.evaluate(async (slug) => {
    await fetch(`/api/engagement/${slug}/inicio`).catch(() => undefined);
  }, fixture.siteSlug);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return { names: await caches.keys(), urls };
  });
  expect(cached.names.some((name) => name.startsWith("impulza-static-"))).toBe(true);
  expect(cached.urls.some((url) => url.endsWith("/offline.html"))).toBe(true);
  expect(cached.urls.some((url) => url.includes("/api/"))).toBe(false);
  // Ninguna página con datos del sitio se guarda: solo estáticos con huella, íconos y la pantalla sin conexión.
  expect(cached.urls.every((url) => /\/_next\/static\/|\/icons\/|\/offline\.html$/.test(url))).toBe(true);

  // Sin conexión: la navegación muestra la pantalla acotada, no una página vieja ni un error del navegador.
  await context.setOffline(true);
  await page.goto(`/${fixture.siteSlug}`);
  await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

  // De vuelta en línea, el sitio carga normal.
  await context.setOffline(false);
  await page.goto(`/${fixture.siteSlug}`);
  await expect(page.getByRole("heading", { name: "Sin conexión" })).toHaveCount(0);

  await context.close();
});

test("una versión nueva no se activa sola: el aviso aparece y solo «Actualizar» la activa", async ({ browser }, testInfo) => {
  const use = testInfo.project.use as BrowserContextOptions;
  const context = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
  const page = await context.newPage();
  await page.goto(`/${fixture.siteSlug}`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: 30_000 }).toBe(true);

  // Una versión nueva: el navegador la instala y queda en espera (la dirección del script cambia, como cambia en cada despliegue).
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js?v=2", { scope: "/" });
  });
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null), { timeout: 30_000 }).toBe("installed");
  // La página lo ofrece y la versión anterior sigue al mando: nada se activó solo.
  await expect(page.getByText("Hay una versión nueva disponible.")).toBeVisible();
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? "")).not.toContain("v=2");

  await page.getByRole("button", { name: "Actualizar" }).click();
  // Al aceptar, la página se recarga sola una vez con la versión nueva: se espera a que termine de cambiar.
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? "");
        } catch {
          return "recargando";
        }
      },
      { timeout: 30_000 },
    )
    .toContain("v=2");
  // (La página recargada vuelve a registrar `/sw.js`, distinto del `?v=2` de esta prueba; en producción la dirección es siempre la misma.)

  await context.close();
});
