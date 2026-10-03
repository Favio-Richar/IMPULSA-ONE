import path from "node:path";
import { randomBytes } from "node:crypto";
import { deflateSync, crc32 } from "node:zlib";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { DASHBOARD_URL } from "../playwright.config.js";

// F9.2 (ADR-028 §4) — Marca de cada organización configurable desde Configuración › Marca.
// El usuario configura nombre visible y colores desde su panel.
// Se valida contraste WCAG 2.2 AA (>= 4.5:1), persistencia y estados de formulario.
// Se prueba en móvil (Pixel 7) y escritorio (1440px).

test.use({ baseURL: DASHBOARD_URL });
test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;

const CAPTURES_DIR = (() => {
  const candidates = [
    path.resolve(process.cwd(), "docs/design/capturas/f92"),
    path.resolve(process.cwd(), "../../docs/design/capturas/f92"),
  ];
  for (const dir of candidates) {
    if (existsSync(path.dirname(dir))) {
      mkdirSync(dir, { recursive: true });
      return dir;
    }
  }
  return candidates[0]!;
})();

/** PNG real (decodificable) con ruido incompresible: pesa lo que pesaría un logo de verdad. */
function makeNoisePng(side: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // profundidad
  header[9] = 6; // RGBA
  const rows = Buffer.concat(Array.from({ length: side }, () => Buffer.concat([Buffer.from([0]), randomBytes(side * 4)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test("Marca de la organización (/configuracion/marca): contraste AA, vista previa y persistencia", async ({
  page,
}, testInfo) => {
  // Asegurar que la organización sembrada está activa en el cliente
  await page.addInitScript((orgId) => {
    window.localStorage.setItem(
      "impulza-active-org",
      JSON.stringify({ state: { activeOrganizationId: orgId }, version: 0 }),
    );
  }, fixture.organizationId);

  // 1. Navegar a Configuración › Marca
  await page.goto("/configuracion/marca");

  // 2. Esperar a que la página cargue el formulario
  await page.waitForSelector("[data-testid='brand-form']", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Marca de la organización" })).toBeVisible();

  // 3. Captura inicial de la pantalla
  await page.screenshot({
    path: path.join(CAPTURES_DIR, `01-marca-org-inicial-${testInfo.project.name}.png`),
    fullPage: false,
  });

  await expectNoHorizontalScroll(page);

  // 4. Probar validación de contraste insuficiente: amarillo sobre blanco (< 4.5:1)
  const primaryCodeInput = page.getByLabel("Código hexadecimal").first();
  await primaryCodeInput.fill("#ffff00");
  await expect(page.getByText("Rechazado < 4.5:1").first()).toBeVisible();

  const submitButton = page.getByRole("button", { name: "Guardar cambios de marca" });
  await expect(submitButton).toBeDisabled();

  // 5. Configurar datos válidos: color con contraste >= 4.5:1 y nombre visible
  await primaryCodeInput.fill("#0f6f6b"); // Contraste 5.99:1
  await expect(page.getByText("Pasa AA").first()).toBeVisible();
  await expect(submitButton).toBeEnabled();

  const displayNameInput = page.getByLabel("Nombre visible");
  await displayNameInput.fill("Café Del Sol E2E");

  const contactEmailInput = page.getByLabel("Correo de contacto");
  await contactEmailInput.fill("contacto@cafedelsol.cl");

  // 6. Captura con datos válidos y vista previa activa
  await page.screenshot({
    path: path.join(CAPTURES_DIR, `02-marca-org-editada-${testInfo.project.name}.png`),
    fullPage: false,
  });

  // 7. Enviar y guardar cambios
  await submitButton.click();
  await expect(
    page.getByText("Configuración de marca guardada correctamente."),
  ).toBeVisible({ timeout: 10_000 });

  // 8. Captura con mensaje de confirmación
  await page.screenshot({
    path: path.join(CAPTURES_DIR, `03-marca-org-guardada-${testInfo.project.name}.png`),
    fullPage: false,
  });

  // 9. Recargar y comprobar persistencia
  await page.reload();
  await page.waitForSelector("[data-testid='brand-form']", { timeout: 20_000 });

  await expect(page.getByLabel("Nombre visible")).toHaveValue("Café Del Sol E2E");
  await expect(page.getByLabel("Código hexadecimal").first()).toHaveValue("#0f6f6b");
  await expect(page.getByLabel("Correo de contacto")).toHaveValue("contacto@cafedelsol.cl");

  // 10. Captura final tras recarga
  await page.screenshot({
    path: path.join(CAPTURES_DIR, `04-marca-org-recargada-${testInfo.project.name}.png`),
    fullPage: false,
  });

  await expectNoHorizontalScroll(page);
});

test("F9.2: sube un logo de ~200 KB, se ve en la vista previa y sigue ahí tras recargar", async ({ page }, testInfo) => {
  await page.addInitScript((orgId) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: orgId }, version: 0 }));
  }, fixture.organizationId);
  await page.goto("/configuracion/marca");
  await page.waitForSelector("[data-testid='brand-form']", { timeout: 20_000 });

  const png = makeNoisePng(220); // ~190 KB: antes de la corrección la subida daba 413 desde ~75 KB
  expect(png.length).toBeGreaterThan(150_000);
  await page.getByLabel("Logo (fondo claro)").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });

  const logo = page.getByAltText("Logo claro");
  await expect(logo).toBeVisible({ timeout: 20_000 });
  await expect(logo).toHaveAttribute("src", new RegExp(`/branding/org/${fixture.organizationId}/logo_light-\\d+\\.png$`));

  await page.getByRole("button", { name: "Guardar cambios de marca" }).click();
  await expect(page.getByText("Configuración de marca guardada correctamente.")).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await page.waitForSelector("[data-testid='brand-form']", { timeout: 20_000 });
  await expect(page.getByAltText("Logo claro")).toBeVisible();
  await expect.poll(() => page.getByAltText("Logo claro").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: path.join(CAPTURES_DIR, `05-logo-subido-${testInfo.project.name}.png`), fullPage: false });
});
