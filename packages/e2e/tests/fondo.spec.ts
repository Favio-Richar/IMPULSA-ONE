import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// PP3 — fondo premium de la página, contra la API, MinIO y el worker reales: elegir un degradado y
// verlo en la vista previa del constructor con el texto aclarado (y las tarjetas con los colores del
// tema), rechazar un color ilegible, y sobre una foto clara ofrecer solo la capa que alcanza AA.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;

/** PNG de `width`×`height`: la mitad de arriba casi blanca y la de abajo oscura. */
function brightPng(width: number, height: number): Buffer {
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
  header[8] = 8;
  header[9] = 2;
  const rowOf = (rgb: [number, number, number]) => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from(rgb))]);
  const light = rowOf([245, 245, 244]);
  const dark = rowOf([28, 25, 23]);
  const raw = Buffer.concat(Array.from({ length: height }, (_, y) => (y < height / 2 ? light : dark)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function backgroundCard(page: Page): Locator {
  return page.locator("div").filter({ has: page.getByText("Fondo de la página", { exact: true }) }).filter({ has: page.getByRole("button", { name: "Aplicar fondo" }) }).last();
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Los radios están ocultos visualmente dentro de su etiqueta: se elige haciendo clic en ella, como una persona. */
async function choose(scope: Locator, name: string): Promise<void> {
  const radio = scope.getByRole("radio", { name, exact: true });
  await scope.locator("label").filter({ has: scope.page().getByRole("radio", { name, exact: true }) }).click();
  await expect(radio).toBeChecked();
}

async function applyAndConfirm(card: Locator): Promise<void> {
  await card.getByRole("button", { name: "Aplicar fondo" }).click();
  await expect(card.getByText("Fondo aplicado. Ya se ve en tu página pública.")).toBeVisible({ timeout: 10_000 });
}

test("un degradado oscuro se ve en el constructor con el texto aclarado y las tarjetas intactas", async ({ page }) => {
  await page.goto(`/sitios/${fixture.siteId}`);
  const card = backgroundCard(page);
  await expect(card).toBeVisible();

  await choose(card, "Degradado");
  await choose(card, "Medianoche");
  await expect(card.getByRole("img", { name: "Vista previa del fondo" }).locator('[data-background="gradient"]')).toBeVisible();
  await applyAndConfirm(card);
  await expectNoHorizontalScroll(page);

  await page.goto(`/sitios/${fixture.siteId}/paginas/${fixture.pageId}/editor`);
  const preview = page.locator('[data-background="gradient"]');
  await expect(preview).toBeVisible();
  // Texto directo sobre el fondo: blanco. Dentro de la portada (una superficie del tema): el del tema.
  const paragraph = preview.getByText("Un párrafo de ejemplo para el lienzo.");
  await expect.poll(() => paragraph.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(255, 255, 255)");
  const heroTitle = preview.getByRole("heading", { name: "Bienvenido a Impulza" });
  await expect.poll(() => heroTitle.evaluate((element) => getComputedStyle(element).color)).not.toBe("rgb(255, 255, 255)");

  // Se deja el sitio con el fondo del tema para el resto de las pruebas.
  await page.goto(`/sitios/${fixture.siteId}`);
  await choose(backgroundCard(page), "Del tema");
  await applyAndConfirm(backgroundCard(page));
});

test("un color con el que ningún texto se lee no se puede aplicar", async ({ page }) => {
  await page.goto(`/sitios/${fixture.siteId}`);
  const card = backgroundCard(page);
  await choose(card, "Color");
  const hex = card.getByRole("textbox", { name: "Color", exact: true });
  await hex.fill("#777777");
  await expect(card.getByRole("alert").filter({ hasText: "ningún texto se lee bien" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Aplicar fondo" })).toBeDisabled();
  await hex.fill("#0b1f3a");
  await expect(card.getByRole("button", { name: "Aplicar fondo" })).toBeEnabled();
});

test("sobre una foto clara solo se ofrece la capa que deja leer el texto", async ({ page }) => {
  await page.goto(`/sitios/${fixture.siteId}`);
  const card = backgroundCard(page);
  await choose(card, "Imagen");
  await card.getByRole("button", { name: "Elegir imagen" }).click();

  const dialog = page.getByRole("dialog", { name: "Elegir imagen" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "cielo.png", mimeType: "image/png", buffer: brightPng(1600, 900) });
  await expect(dialog.getByRole("radio", { checked: true })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: "Usar imagen" }).click();
  await expect(dialog).toBeHidden();

  await expect(card.getByRole("radio", { name: "Suave" })).toBeDisabled();
  await expect(card.getByRole("radio", { name: "Media" })).toBeDisabled();
  await expect(card.getByRole("radio", { name: "Fuerte" })).toBeChecked();
  await expect(card.getByRole("img", { name: "Vista previa del fondo" }).locator('[data-overlay="dark-strong"]')).toBeAttached();
  await applyAndConfirm(card);
  await expectNoHorizontalScroll(page);

  await choose(card, "Del tema");
  await applyAndConfirm(card);
});
