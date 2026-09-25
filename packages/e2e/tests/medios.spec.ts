import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// PP2 — biblioteca de medios y selector en los bloques, contra la API, MinIO y el worker reales:
// subir desde /medios con progreso, verla optimizada en la grilla, y elegirla como fondo de la
// portada desde el constructor (con autoguardado). Sin desplazamiento horizontal en ningún viewport.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;

/** PNG real de `width`×`height` de un color, armado a mano (sin dependencias de imagen). */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(typed));
    return Buffer.concat([length, typed, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // profundidad de bits
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from(rgb))]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("sube una imagen desde /medios y la muestra optimizada en la biblioteca", async ({ page }, testInfo) => {
  const fileName = `portada-${testInfo.project.name}-${Date.now().toString(36)}.png`;
  await page.goto("/medios");
  await expect(page.getByRole("heading", { name: "Medios", exact: true })).toBeVisible();
  await expect(page.getByLabel("Uso de almacenamiento")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: "image/png", buffer: png(1200, 675, [15, 111, 107]) });

  const uploads = page.getByRole("list", { name: "Subidas" });
  await expect(uploads.getByText(fileName)).toBeVisible();
  await expect(uploads.getByText("Lista")).toBeVisible({ timeout: 30_000 });

  // En la grilla, con sus dimensiones reales y la miniatura (variante WebP) cargada.
  const card = page.getByRole("listitem").filter({ hasText: fileName }).last();
  await expect(card.getByText("1200×675")).toBeVisible();
  const thumbnail = card.locator("img");
  await expect(thumbnail).toHaveAttribute("src", /w400\.webp$/);
  await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(400);
  await expectNoHorizontalScroll(page);
});

test("rechaza un archivo que no es una imagen permitida antes de subirlo", async ({ page }) => {
  await page.goto("/medios");
  await page.locator('input[type="file"]').setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
  const uploads = page.getByRole("list", { name: "Subidas" });
  await expect(uploads.getByText("No se pudo subir")).toBeVisible();
  await expect(uploads.getByText(/Formato no permitido/)).toBeVisible();
});

test("en el constructor, elige una imagen de la biblioteca como fondo de la portada y se guarda", async ({ page }) => {
  await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
  await expect(page.getByRole("heading", { name: "Constructor visual" })).toBeVisible();
  await page.getByRole("region", { name: "Lienzo" }).getByRole("button", { name: "Portada" }).click();

  const panel = page.getByRole("region", { name: "Configuración del bloque" });
  await panel.getByRole("button", { name: "Elegir imagen" }).click();

  const dialog = page.getByRole("dialog", { name: "Elegir imagen" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Recomendado: horizontal 16:9/)).toBeVisible();
  // Sube una en el momento: queda elegida sola al terminar.
  await dialog.locator('input[type="file"]').setInputFiles({ name: "fondo.png", mimeType: "image/png", buffer: png(1600, 900, [107, 79, 58]) });
  await expect(dialog.getByRole("radio", { checked: true })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Usar imagen" }).click();
  await expect(dialog).toBeHidden();

  // Vista previa en el panel, texto alternativo y autoguardado.
  await expect(panel.getByText("De tu biblioteca")).toBeVisible();
  // Sin texto alternativo no se guarda: el aviso aparece junto al campo (misma regla que la API).
  await expect(panel.getByRole("alert").filter({ hasText: "Describe la imagen o márcala como decorativa." })).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText("Revisa los campos marcados abajo")).toBeVisible();
  await panel.getByLabel("Texto alternativo").fill("Interior del café con luz de la tarde");
  await expect(page.getByText(/Guardado/).first()).toBeVisible({ timeout: 10_000 });

  // Tras recargar, el bloque conserva la imagen de la biblioteca.
  await page.reload();
  await page.getByRole("region", { name: "Lienzo" }).getByRole("button", { name: "Portada" }).click();
  await expect(page.getByRole("region", { name: "Configuración del bloque" }).getByText("De tu biblioteca")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Se deja la portada como estaba (sin fondo) para el resto de las pruebas.
  await page.getByRole("region", { name: "Configuración del bloque" }).getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByText(/Guardado/).first()).toBeVisible({ timeout: 10_000 });
});
