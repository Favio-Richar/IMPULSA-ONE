import { expect, test } from "@playwright/test";

// F3.7 — dashboard de conversión. Con los agregados sembrados en global-setup, afirma que la
// pantalla muestra datos reales de la API (no un estado vacío) y las mismas propiedades de layout
// que el resto del panel: sin desplazamiento horizontal y filtros alcanzables, en teléfono y
// escritorio.

test.beforeEach(async ({ page }) => {
  await page.goto("/analitica");
  await expect(page.getByRole("heading", { name: "Analítica", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Actividad por día" })).toBeVisible();
});

test("muestra el resumen, el gráfico y el embudo con datos reales", async ({ page }) => {
  const resumen = page.getByRole("region", { name: "Resumen" });
  await expect(resumen.getByText("Visitas", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Embudo de conversión" })).toBeVisible();
  await expect(page.getByText("Chile")).toBeVisible();
  // El gráfico se dibuja de verdad (Recharts pinta un SVG con su área).
  await expect(page.locator(".recharts-area-area").first()).toBeVisible();
});

test("la serie se puede leer como tabla", async ({ page }) => {
  const serie = page.getByRole("region", { name: "Actividad por día" });
  await serie.getByRole("button", { name: "Ver como tabla" }).click();
  await expect(serie.getByRole("columnheader", { name: "Día" })).toBeVisible();
  // 30 días por defecto: una fila por día más el encabezado.
  await expect(serie.getByRole("row")).toHaveCount(31);
});

test("cambiar el período vuelve a consultar y mantiene la pantalla estable", async ({ page }) => {
  await page.getByRole("button", { name: "7 días" }).click();
  const serie = page.getByRole("region", { name: "Actividad por día" });
  await serie.getByRole("button", { name: "Ver como tabla" }).click();
  await expect(serie.getByRole("row")).toHaveCount(8);
});

test("no genera desplazamiento horizontal", async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("los filtros quedan dentro de la pantalla", async ({ page }) => {
  const viewportWidth = page.viewportSize()!.width;
  for (const control of [
    page.getByLabel("Sitio"),
    page.getByRole("button", { name: "30 días" }),
    page.getByRole("button", { name: "Personalizado" }),
    page.getByLabel("Desde"),
    page.getByLabel("Hasta"),
  ]) {
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
  }
});

test("al pasar (o tocar, en un teléfono) sobre el gráfico muestra el día y su valor", async ({ page, isMobile }) => {
  const grafico = page.locator(".recharts-surface").first();
  await grafico.scrollIntoViewIfNeeded();
  const box = (await grafico.boundingBox())!;
  const x = box.x + box.width * 0.85;
  const y = box.y + box.height * 0.5;
  if (isMobile) {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.move(x, y);
  }
  await expect(page.locator(".recharts-tooltip-wrapper")).toContainText(/\d+ visitas/);
});
