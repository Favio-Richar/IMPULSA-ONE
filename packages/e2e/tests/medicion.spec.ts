import { readFileSync } from "node:fs";
import { expect, request as apiRequest, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F7.1 (ADR-016) — GA4 y píxel de Meta con consentimiento, en un navegador real contra el build de
// producción (con su CSP). Los scripts de Google y Meta se reemplazan por versiones de prueba que
// registran cada llamada: así se afirma qué sale y cuándo, sin depender de terceros. Lo central:
// **ninguna petición a terceros antes de consentir**.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const CAPTURES = ".playwright/capturas/f71";
const GA4 = "G-E2ETEST123";
const PIXEL = "1234567890123456";
const THIRD_PARTY = /googletagmanager\.com|google-analytics\.com|connect\.facebook\.net|facebook\.com\/tr/;

// Versión de prueba de fbevents.js: procesa la cola de `fbq` y registra cada llamada.
const FAKE_FBEVENTS = `(function(){var f=window.fbq;window.__fbCalls=window.__fbCalls||[];f.callMethod=function(){window.__fbCalls.push(Array.prototype.slice.call(arguments));};(f.queue||[]).forEach(function(a){f.callMethod.apply(null,a);});f.queue=[];})();`;

let api: APIRequestContext;
let productId = "";
let blockId = "";
let productName = "";

async function revalidate(): Promise<void> {
  const revalidated = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
    headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
    data: { siteSlug: fixture.siteSlug },
  });
  expect(revalidated.status()).toBe(200);
}

test.beforeAll(async () => {
  const testInfo = test.info();
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  productName = `Curso medición ${testInfo.project.name} ${Date.now().toString(36)}`;
  const product = await api.post(`${site}/catalog/products`, { headers: CSRF, data: { name: productName, kind: "SERVICE", priceAmount: 12_990, priceCurrency: "CLP" } });
  expect(product.status()).toBe(201);
  productId = ((await product.json()) as { id: string }).id;
  const block = await api.post(`${site}/pages/${fixture.pageId}/blocks`, { headers: CSRF, data: { type: "catalog", config: { label: `Tienda medición ${testInfo.project.name}`, productIds: [productId] } } });
  expect(block.status()).toBe(201);
  blockId = ((await block.json()) as { id: string }).id;
  expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
  expect((await api.put(`${site}/measurement`, { headers: CSRF, data: { ga4MeasurementId: GA4, metaPixelId: PIXEL } })).status()).toBe(200);
  await revalidate();
});

test.afterAll(async () => {
  await api.put(`${site}/measurement`, { headers: CSRF, data: { ga4MeasurementId: null, metaPixelId: null } });
  await api.delete(`${site}/pages/${fixture.pageId}/blocks/${blockId}`, { headers: CSRF });
  await api.delete(`${site}/catalog/products/${productId}`, { headers: CSRF });
  await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
  await revalidate();
  await api.dispose();
});

/** Contexto nuevo (sin elección guardada) que sirve las versiones de prueba y cuenta lo que sale a terceros. */
async function visitor(browser: import("@playwright/test").Browser, viewport: { width: number; height: number }) {
  const context: BrowserContext = await browser.newContext({ viewport, locale: "es-CL" });
  const thirdParty: string[] = [];
  context.on("request", (request) => {
    if (THIRD_PARTY.test(request.url())) thirdParty.push(request.url());
  });
  await context.route("https://www.googletagmanager.com/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "/* gtag.js de prueba */" }));
  await context.route("https://connect.facebook.net/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: FAKE_FBEVENTS }));
  // Violaciones de CSP de la página, para afirmar que la política permite lo necesario y nada más.
  await context.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI} (${event.sourceFile}:${event.lineNumber})`);
    });
  });
  const page = await context.newPage();
  return { context, page, thirdParty };
}

async function capture(page: Page, file: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}` });
  await page.emulateMedia({ reducedMotion: null });
}

const cspViolations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
// `gtag` empuja el objeto `arguments` (así lo espera gtag.js): se pasa a arreglo para comparar.
const dataLayer = (page: Page) =>
  page.evaluate(() => JSON.parse(JSON.stringify(((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((entry) => Array.from(entry)))) as unknown[][]);
const fbCalls = (page: Page) => page.evaluate(() => (window as unknown as { __fbCalls?: unknown[][] }).__fbCalls ?? []);

test("sin elección no sale nada a terceros; el aviso ofrece aceptar y rechazar con el mismo peso", async ({ browser, viewport }, testInfo) => {
  const { context, page, thirdParty } = await visitor(browser, viewport!);
  try {
    await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
    const banner = page.getByRole("dialog", { name: /Cookies en/ });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Google Analytics");
    await expect(banner).toContainText("píxel de Meta");
    const accept = banner.getByRole("button", { name: "Aceptar" });
    const reject = banner.getByRole("button", { name: "Rechazar" });
    const [a, r] = [(await accept.boundingBox())!, (await reject.boundingBox())!];
    expect(Math.abs(a.height - r.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.width - r.width)).toBeLessThanOrEqual(2);
    expect(a.height).toBeGreaterThanOrEqual(44);
    expect(await accept.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await reject.evaluate((el) => getComputedStyle(el).backgroundColor));
    await page.waitForLoadState("networkidle");
    expect(thirdParty).toEqual([]);
    expect(await cspViolations(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await capture(page, `aviso-${testInfo.project.name}.png`);
  } finally {
    await context.close();
  }
});

test("rechazar: nada se carga, ni al volver; «Preferencias de cookies» reabre el aviso", async ({ browser, viewport }) => {
  const { context, page, thirdParty } = await visitor(browser, viewport!);
  try {
    await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
    await page.getByRole("dialog", { name: /Cookies en/ }).getByRole("button", { name: "Rechazar" }).click();
    await expect(page.getByRole("dialog", { name: /Cookies en/ })).toHaveCount(0);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("dialog", { name: /Cookies en/ })).toHaveCount(0);
    expect(thirdParty).toEqual([]);
    expect(await page.evaluate(() => typeof (window as unknown as { gtag?: unknown }).gtag)).toBe("undefined");
    await page.getByRole("button", { name: "Preferencias de cookies" }).click();
    await expect(page.getByRole("dialog", { name: /Cookies en/ }).getByRole("checkbox", { name: /Analítica/ })).not.toBeChecked();
  } finally {
    await context.close();
  }
});

test("aceptar: carga GA4 y Meta, mide la vista y el pedido con valor, sin datos personales; sin violaciones de CSP", async ({ browser, viewport }, testInfo) => {
  const { context, page, thirdParty } = await visitor(browser, viewport!);
  try {
    await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
    await page.getByRole("dialog", { name: /Cookies en/ }).getByRole("button", { name: "Aceptar" }).click();
    await expect.poll(() => thirdParty.some((url) => url.includes(`googletagmanager.com/gtag/js?id=${GA4}`))).toBe(true);
    await expect.poll(() => thirdParty.some((url) => url.includes("connect.facebook.net"))).toBe(true);

    const config = (await dataLayer(page)).find((entry) => entry[0] === "config");
    expect(config).toEqual(["config", GA4, { allow_google_signals: false, allow_ad_personalization_signals: false }]);
    await expect.poll(async () => JSON.stringify(await fbCalls(page))).toContain(JSON.stringify(["init", PIXEL]));
    expect(JSON.stringify(await fbCalls(page))).toContain(JSON.stringify(["track", "PageView"]));

    // Un pedido desde la tienda: GA4 begin_checkout y Meta InitiateCheckout, con valor en pesos.
    const email = `medicion-${Date.now().toString(36)}@e2e.test`;
    await page.locator("summary", { hasText: productName }).click();
    const form = page.getByRole("form", { name: productName });
    await form.getByLabel("Nombre *").fill("Cliente Medición");
    await form.getByLabel("Correo *").fill(email);
    await form.getByText("Acepto que este negocio").click();
    await form.getByRole("button", { name: /Hacer pedido/ }).click();
    await expect(page.getByRole("heading", { name: "¡Pedido recibido!" })).toBeVisible();

    await expect.poll(async () => (await dataLayer(page)).some((entry) => entry[0] === "event" && entry[1] === "begin_checkout")).toBe(true);
    const checkout = (await dataLayer(page)).find((entry) => entry[0] === "event" && entry[1] === "begin_checkout");
    expect(checkout).toEqual(["event", "begin_checkout", { currency: "CLP", value: 12_990 }]);
    await expect.poll(async () => JSON.stringify(await fbCalls(page))).toContain(JSON.stringify(["track", "InitiateCheckout", { currency: "CLP", value: 12_990 }]));
    // Nada personal a terceros: ni el correo ni el nombre en ninguna llamada ni URL.
    const everything = JSON.stringify([await dataLayer(page), await fbCalls(page), thirdParty]);
    expect(everything).not.toContain(email);
    expect(everything).not.toContain("Cliente Medición");
    expect(await cspViolations(page)).toEqual([]);
    await capture(page, `aceptado-${testInfo.project.name}.png`);
  } finally {
    await context.close();
  }
});

test("configurar: solo analítica carga solo GA4; retirarla la apaga", async ({ browser, viewport }) => {
  const { context, page, thirdParty } = await visitor(browser, viewport!);
  try {
    await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
    const banner = page.getByRole("dialog", { name: /Cookies en/ });
    await banner.getByRole("button", { name: "Configurar" }).click();
    await banner.getByRole("checkbox", { name: /Analítica/ }).check();
    await banner.getByRole("button", { name: "Guardar mi elección" }).click();
    await expect.poll(() => thirdParty.some((url) => url.includes("googletagmanager.com"))).toBe(true);
    await page.waitForLoadState("networkidle");
    expect(thirdParty.some((url) => url.includes("facebook"))).toBe(false);

    await page.getByRole("button", { name: "Preferencias de cookies" }).click();
    await page.getByRole("dialog", { name: /Cookies en/ }).getByRole("checkbox", { name: /Analítica/ }).uncheck();
    await page.getByRole("dialog", { name: /Cookies en/ }).getByRole("button", { name: "Guardar mi elección" }).click();
    expect(await page.evaluate((id) => (window as unknown as Record<string, unknown>)[`ga-disable-${id}`], GA4)).toBe(true);
  } finally {
    await context.close();
  }
});

test("el panel configura la medición: valida el formato y muestra el estado", async ({ page }, testInfo) => {
  await page.goto(`/sitios/${fixture.siteId}`);
  const form = page.getByRole("form", { name: "Medición del sitio" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("ID de medición")).toHaveValue(GA4);
  await form.getByLabel("ID de medición").fill("<script>alert(1)</script>");
  await form.getByRole("button", { name: "Guardar medición" }).click();
  await expect(form.getByText("empieza con «G-»")).toBeVisible();
  await form.getByLabel("ID de medición").fill(GA4.toLowerCase());
  await form.getByRole("button", { name: "Guardar medición" }).click();
  await expect(form.getByRole("status")).toHaveText("Guardado. Tu página ya lo usa.");
  await expect(form.getByLabel("ID de medición")).toHaveValue(GA4);
  await form.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${CAPTURES}/panel-${testInfo.project.name}.png`, fullPage: true });
});
