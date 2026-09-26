import { readFileSync } from "node:fs";
import { IN_APP_USER_AGENTS } from "@impulza/analytics";
import { PrismaClient } from "@impulza/database";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";
import { preparePublishedVideoPage } from "./support/published-page.js";

// PP7 — la página pública dentro de los navegadores internos de Instagram, TikTok, Facebook y
// Pinterest, que es donde se abre la mayoría de las visitas (se toca el enlace de la biografía). Con
// sus user-agents reales y contra el sitio en modo producción: se ve completa, el video tiene la
// combinación de atributos que esos navegadores reproducen solos, la acción principal aparece, y la
// visita **cuenta** en la analítica como visita de teléfono (antes de PP7, Instagram en Android se
// contaba como tablet y Pinterest se descartaba como bot).

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;

test.describe.configure({ mode: "serial" });
test.skip(!process.env.FFMPEG_PATH, "FFMPEG_PATH no configurado: sin video de fondo no hay escenario completo.");

let api: APIRequestContext;
let cleanup: (() => Promise<void>) | null = null;
const prisma = new PrismaClient();

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(180_000);
  api = await playwright.request.newContext({ storageState: "./.playwright/session.json" });
  cleanup = await preparePublishedVideoPage(api, fixture);
});

test.afterAll(async () => {
  await cleanup?.();
  await api?.dispose();
  await prisma.$disconnect();
});

for (const [app, userAgent] of Object.entries(IN_APP_USER_AGENTS)) {
  test(`se ve y cuenta desde el navegador de ${app}`, async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "movil", "Los navegadores internos son de teléfono.");
    const context = await browser.newContext({ userAgent, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "es-CL" });
    const page = await context.newPage();
    const mobileViews = () => prisma.analyticsEvent.count({ where: { siteId: fixture.siteId, type: "page_view", device: "mobile" } });
    // La prueba anterior esperó a que llegara su propio evento: este número ya no se mueve solo.
    const before = await mobileViews();

    try {
      const response = await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
      expect(response?.status()).toBe(200);

      // Se ve completa: perfil con sus redes, sin desplazamiento horizontal.
      await expect(page.getByRole("heading", { name: "Estudio Aroma" })).toBeVisible();
      const socials = page.getByRole("navigation", { name: "Redes de Estudio Aroma" }).getByRole("link");
      await expect(socials).toHaveCount(3);
      for (const link of await socials.all()) {
        // Abren afuera (en la app de la red), sin filtrar desde dónde se llegó.
        await expect(link).toHaveAttribute("target", "_blank");
        await expect(link).toHaveAttribute("rel", /noopener/);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

      // Video de fondo: póster primero y la única combinación que estos navegadores reproducen solos.
      const video = page.locator('[data-background="video"] video');
      await expect(video).toHaveAttribute("src", /\/video\.mp4$/);
      expect(
        await video.evaluate((element: HTMLVideoElement) => ({
          muted: element.muted,
          playsInline: element.playsInline,
          autoplay: element.autoplay,
          loop: element.loop,
        })),
      ).toEqual({ muted: true, playsInline: true, autoplay: true, loop: true });

      // Acción principal: la barra del teléfono repite el enlace del bloque principal. Con el botón
      // original a la vista se esconde (y queda `inert`: nadie llega por teclado a algo invisible).
      const bar = page.locator("[data-primary-action-bar]");
      await expect(bar).toHaveAttribute("data-block-type", "link");
      await expect(bar.locator("a")).toHaveAttribute("href", "https://ejemplo.com");
      await page.locator("[data-primary-action]").scrollIntoViewIfNeeded();
      await expect(bar).toHaveAttribute("data-state", "hidden");

      // La visita cuenta: el evento llega a la base como vista de página desde un teléfono.
      await expect.poll(mobileViews, { timeout: 20_000, intervals: [500] }).toBe(before + 1);
    } finally {
      await context.close();
    }
  });
}
