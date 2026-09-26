import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";
import { preparePublishedVideoPage } from "./support/published-page.js";

// PP7 — revisión visual de la página pública real (modo producción): cada tema del catálogo con su
// fondo, y un tema de cada línea con degradado, imagen y video propio, en teléfono y escritorio. Deja
// las capturas en `.playwright/revision-visual/` para revisarlas a ojo, y afirma lo que se puede medir
// (ADR-003: propiedades, no píxeles): nada se desborda en horizontal, el perfil se ve, y sobre el
// fondo del tema el nombre alcanza contraste AA medido en el navegador.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const OUT = path.join(import.meta.dirname, "..", ".playwright", "revision-visual");
const STRONG_DARK = { tone: "dark", strength: "strong" } as const;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.FFMPEG_PATH, "FFMPEG_PATH no configurado: sin video de fondo la revisión queda incompleta.");

let api: APIRequestContext;
let cleanup: (() => Promise<void>) | null = null;
let themes: Array<{ id: string; code: string | null; family: string | null }> = [];
let imageUrl = "";
let videoUrl = "";
const org = `${API_BASE_URL}/organizations/${fixture.organizationId}`;
const site = `${org}/sites/${fixture.siteId}`;

/** Una "foto" 16:9 con degradado de colores, generada con ffmpeg (nada binario en el repositorio). */
function photo(): Buffer {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "impulza-e2e-foto-")), "foto.png");
  const result = spawnSync(process.env.FFMPEG_PATH!, [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "gradients=s=1600x900:c0=0x1d4ed8:c1=0xf59e0b:c2=0x0f766e:n=3", "-frames:v", "1", "-y", file,
  ]);
  expect(result.status, result.stderr.toString()).toBe(0);
  return readFileSync(file);
}

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(240_000);
  api = await playwright.request.newContext({ storageState: "./.playwright/session.json" });
  cleanup = await preparePublishedVideoPage(api, fixture);

  themes = (await (await api.get(`${org}/themes`)).json()) as typeof themes;
  const background = (await (await api.get(`${site}/background`)).json()) as { background: { video: { src: string } } };
  videoUrl = background.background.video.src;

  const bytes = photo();
  const requested = await api.post(`${org}/media/uploads`, { headers: CSRF, data: { fileName: "foto.png", contentType: "image/png", sizeBytes: bytes.byteLength } });
  const { asset, upload } = (await requested.json()) as { asset: { id: string }; upload: { url: string; headers: Record<string, string> } };
  expect((await api.put(upload.url, { headers: upload.headers, data: bytes })).ok()).toBe(true);
  await api.post(`${org}/media/${asset.id}/confirm`, { headers: CSRF });
  await expect
    .poll(async () => ((await (await api.get(`${org}/media/${asset.id}`)).json()) as { status: string; url: string }).status, { timeout: 60_000 })
    .toBe("READY");
  imageUrl = ((await (await api.get(`${org}/media/${asset.id}`)).json()) as { url: string }).url;
});

test.afterAll(async () => {
  await api?.put(`${site}/theme`, { headers: CSRF, data: { themeId: null } });
  await cleanup?.();
  await api?.dispose();
});

async function show(page: Page, themeCode: string, background: unknown): Promise<void> {
  const theme = themes.find((entry) => entry.code === themeCode)!;
  expect((await api.put(`${site}/theme`, { headers: CSRF, data: { themeId: theme.id } })).ok()).toBe(true);
  expect((await api.put(`${site}/background`, { headers: CSRF, data: { background } })).ok()).toBe(true);
  // Tema y fondo se aplican en vivo: se invalida la caché del sitio público como lo hace la API.
  const revalidated = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
    headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
    data: { siteSlug: fixture.siteSlug },
  });
  expect(revalidated.status()).toBe(200);

  await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
  await expect(page.getByRole("heading", { name: "Estudio Aroma" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // Las animaciones de entrada terminan antes de la captura.
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

/** Contraste WCAG del nombre sobre el color de fondo de la página, con los colores ya calculados. */
async function headingContrast(page: Page): Promise<number> {
  return page.evaluate(() => {
    const parse = (color: string) => (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const luminance = ([r, g, b]: number[]) =>
      [r!, g!, b!].map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    const heading = [...document.querySelectorAll("h1")].find((element) => element.textContent?.includes("Estudio Aroma"))!;
    const root = document.querySelector("[data-site-root]")!;
    const a = luminance(parse(getComputedStyle(heading).color));
    const b = luminance(parse(getComputedStyle(root).backgroundColor));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

const THEME_CODES = [
  "ejecutivo-marino", "ejecutivo-grafito", "ejecutivo-borgona",
  "vibrante-coral", "vibrante-violeta", "vibrante-turquesa",
  "claro-profesional", "editorial", "natural", "oceano", "carbon",
];

for (const code of THEME_CODES) {
  test(`tema ${code} con su fondo`, async ({ page }, testInfo) => {
    await show(page, code, null);
    expect(await headingContrast(page)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: path.join(OUT, testInfo.project.name, `tema-${code}.png`), fullPage: true });
  });
}

for (const code of ["ejecutivo-marino", "vibrante-coral", "claro-profesional"]) {
  for (const kind of ["degradado", "imagen", "video"] as const) {
    test(`tema ${code} sobre ${kind}`, async ({ page }, testInfo) => {
      const background =
        kind === "degradado"
          ? { kind: "gradient", gradient: "medianoche" }
          : kind === "imagen"
            ? { kind: "image", image: { url: imageUrl }, overlay: STRONG_DARK }
            : { kind: "own_video", video: { src: videoUrl }, overlay: STRONG_DARK };
      await show(page, code, background);
      // Sobre un fondo oscuro, el texto que va directo sobre él pasa a claro.
      const color = await page.getByRole("heading", { name: "Estudio Aroma" }).evaluate((element) => getComputedStyle(element).color);
      expect(color).toBe("rgb(255, 255, 255)");
      await page.screenshot({ path: path.join(OUT, testInfo.project.name, `${code}-${kind}.png`), fullPage: true });
    });
  }
}
