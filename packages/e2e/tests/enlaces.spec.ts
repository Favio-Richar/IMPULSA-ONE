import { expect, test } from "@playwright/test";

// F3.5 — panel de enlaces cortos y QR. Recorre el flujo real contra la API (crear un enlace desde
// el formulario, generarle un QR desde su fila) y afirma las mismas propiedades de layout que el
// constructor: sin desplazamiento horizontal de la página y con los controles dentro de la
// pantalla, en teléfono y escritorio.

function uniqueSlug(): string {
  return `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/enlaces");
  await expect(page.getByRole("heading", { name: "Enlaces cortos" })).toBeVisible();
});

test("crea un enlace corto y le genera un código QR", async ({ page }) => {
  const slug = uniqueSlug();
  const createLinkForm = page.getByRole("form", { name: "Crear enlace corto" });
  await createLinkForm.getByLabel("Nombre del enlace").fill(slug);
  await createLinkForm.getByLabel("Destino").fill("https://ejemplo.com/oferta");
  await createLinkForm.getByRole("button", { name: "Crear enlace" }).click();

  const row = page.getByRole("row").filter({ hasText: `/s/${slug}` });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell", { name: "0", exact: true })).toBeVisible();

  // "Crear QR" desde la fila deja el enlace ya elegido en el formulario de QR.
  await row.getByRole("button", { name: "Crear QR" }).click();
  const createQrForm = page.getByRole("form", { name: "Crear código QR" });
  await createQrForm.getByRole("button", { name: "Crear código QR" }).click();

  const qrItem = page.getByRole("listitem").filter({ hasText: `/s/${slug}` });
  await expect(qrItem).toBeVisible();
  await expect(qrItem.getByRole("img", { name: /Código QR hacia .*\/qr\// })).toBeVisible();
  await expect(qrItem).toContainText("0 escaneos");
});

test("rechaza un destino inseguro antes de enviarlo", async ({ page }) => {
  const createLinkForm = page.getByRole("form", { name: "Crear enlace corto" });
  await createLinkForm.getByLabel("Nombre del enlace").fill(uniqueSlug());
  await createLinkForm.getByLabel("Destino").fill("javascript:alert(1)");
  await createLinkForm.getByRole("button", { name: "Crear enlace" }).click();

  await expect(createLinkForm.getByText(/http:\/\/ o https:\/\//)).toBeVisible();
});

test("no genera desplazamiento horizontal", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("los botones de creación quedan dentro de la pantalla", async ({ page }) => {
  const viewportWidth = page.viewportSize()!.width;

  for (const control of [
    page.getByRole("button", { name: "Crear enlace" }),
    page.getByRole("button", { name: "Crear código QR" }),
  ]) {
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
  }
});
