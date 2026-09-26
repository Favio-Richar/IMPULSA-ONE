import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// PP6 (ADR-007) — video de fondo propio, contra la API, MinIO y el worker reales con ffmpeg: subirlo
// desde /medios, verlo convertido en la biblioteca, elegirlo como fondo (solo con una capa que deja
// leer el texto) y verlo en la vista previa del constructor. Sin ffmpeg configurado, se omite.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const FFMPEG = process.env.FFMPEG_PATH;

/** Video vertical claro de 3 s generado con ffmpeg (nada binario en el repositorio). */
function lightVideo(): Buffer {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "impulza-e2e-video-")), "clip.mp4");
  const result = spawnSync(FFMPEG!, [
    "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0xf5f5f4:size=720x1280:rate=30:duration=3,drawbox=y=900:h=380:w=720:color=0x1c1917:t=fill",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", file,
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr.toString());
  }
  return readFileSync(file);
}

function backgroundCard(page: Page): Locator {
  return page.locator("div").filter({ has: page.getByText("Fondo de la página", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Aplicar fondo" }) }).last();
}

/** Los radios están ocultos visualmente dentro de su etiqueta: se elige haciendo clic en ella. */
async function choose(scope: Locator, name: string): Promise<void> {
  const radio = scope.getByRole("radio", { name, exact: true });
  await scope.locator("label").filter({ has: scope.page().getByRole("radio", { name, exact: true }) }).click();
  await expect(radio).toBeChecked();
}

test.skip(!FFMPEG, "FFMPEG_PATH no configurado: la subida de video está deshabilitada en esta instalación.");

test("sube un video, queda convertido y se usa de fondo con una capa legible", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const fileName = `fondo-${testInfo.project.name}-${Date.now().toString(36)}.mp4`;

  await page.goto("/medios");
  await expect(page.getByText("Video para el fondo: MP4, WebM o MOV")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: "video/mp4", buffer: lightVideo() });
  const uploads = page.getByRole("list", { name: "Subidas" });
  await expect(uploads.getByText(fileName)).toBeVisible();
  await expect(uploads.getByText("Lista")).toBeVisible({ timeout: 60_000 });

  // En la grilla: marcado como video, convertido a 720×1280 y con su póster como miniatura.
  const card = page.getByRole("listitem").filter({ hasText: fileName }).last();
  await expect(card.getByText("Video", { exact: true })).toBeVisible();
  await expect(card.getByText("720×1280")).toBeVisible();
  await expect(card.locator("img")).toHaveAttribute("src", /w400\.webp$/);

  await page.goto(`/sitios/${fixture.siteId}`);
  const background = backgroundCard(page);
  await choose(background, "Video");
  await choose(background, fileName);
  // Video mayormente claro: con capa oscura, la suave no deja leer el texto en sus escenas claras.
  await choose(background, "Oscura");
  await expect(background.getByRole("radio", { name: "Suave", exact: true })).toBeDisabled();
  await choose(background, "Fuerte");
  await expect(background.getByRole("img", { name: "Vista previa del fondo" }).locator('[data-background="video"]')).toBeVisible();
  await background.getByRole("button", { name: "Aplicar fondo" }).click();
  await expect(background.getByText("Fondo aplicado. Ya se ve en tu página pública.")).toBeVisible({ timeout: 10_000 });

  try {
    // En el constructor: el póster primero y el video convertido detrás, sin audio que reproducir.
    await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
    const preview = page.locator('[data-background="video"]');
    await expect(preview).toBeVisible();
    const video = preview.locator("video");
    await expect(video).toHaveAttribute("src", /\/video\.mp4$/);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.muted && element.playsInline && element.loop)).toBe(true);
    // Sobre un fondo oscurecido, el texto directo sobre el fondo pasa a claro.
    const paragraph = preview.getByText("Un párrafo de ejemplo para el lienzo.");
    await expect.poll(() => paragraph.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 255, 255)");

    // PL5 (WCAG 1.4.11): el contorno de foco usa el enlace de la página (claro sobre el video
    // oscurecido), no el primario del tema, que sobre una foto puede no distinguirse.
    const link = preview.getByRole("link", { name: "Ver nuestros servicios" });
    expect((await link.evaluate((element) => getComputedStyle(element).getPropertyValue("--site-focus"))).trim()).toBe("#ffffff");

    // PL5 (WCAG 2.2.2): el video en movimiento se puede pausar y volver a reproducir. El botón refleja
    // el estado real: Chrome no reproduce un video silenciado fuera de pantalla (en el panel del
    // teléfono la vista previa queda abajo), así que primero se lleva a la vista.
    await video.scrollIntoViewIfNeeded();
    const toggle = preview.getByRole("button", { name: "Pausar el video de fondo" });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    const box = (await toggle.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(preview.getByRole("button", { name: "Reproducir el video de fondo" })).toBeVisible();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await preview.getByRole("button", { name: "Reproducir el video de fondo" }).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  } finally {
    // El resto de las pruebas espera el fondo del tema.
    await page.goto(`/sitios/${fixture.siteId}`);
    await choose(backgroundCard(page), "Del tema");
    await backgroundCard(page).getByRole("button", { name: "Aplicar fondo" }).click();
    await expect(backgroundCard(page).getByText("Fondo aplicado. Ya se ve en tu página pública.")).toBeVisible({ timeout: 10_000 });
  }
});
