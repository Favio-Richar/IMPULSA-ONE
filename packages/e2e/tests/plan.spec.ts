import { expect, test } from "@playwright/test";

// F4.3 — plan y uso en el panel. La pantalla de plan con datos reales de la API (la organización
// sembrada está en Gratis), y el aviso de "límite alcanzado" en un formulario de creación.

test("la pantalla de plan muestra el plan, el uso y el comparador", async ({ page }) => {
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Plan Gratis" })).toBeVisible();
  await expect(page.getByRole("meter", { name: "Sitios" })).toHaveAttribute("aria-valuetext", /de 1$/);
  await expect(page.getByRole("heading", { name: "Comparar planes" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Agencia/ })).toBeAttached();

  // Mensual ↔ anual cambia los precios mostrados.
  await page.getByRole("radio", { name: "Anual" }).click();
  await expect(page.getByText("al año").first()).toBeVisible();
});

test("la pantalla de plan no genera desplazamiento horizontal de la página", async ({ page }) => {
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Comparar planes" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("al llegar al límite, el formulario muestra el aviso con el camino a Planes", async ({ page }) => {
  // La respuesta real del servidor al pasar el límite (F4.2), simulada solo para esta alta: llenar
  // de verdad los enlaces de la organización compartida rompería las demás pruebas. La aplicación
  // del límite en el servidor tiene sus propias pruebas en apps/api (plan-limits.e2e.test.ts).
  await page.route("**/api/v1/organizations/*/short-links", async (route) => {
    if (route.request().method() !== "POST") {
      return route.continue();
    }
    await route.fulfill({
      status: 402,
      contentType: "application/json",
      body: JSON.stringify({
        statusCode: 402,
        code: "PLAN_LIMIT_REACHED",
        message: "Llegaste al máximo de enlaces cortos de tu plan.",
        limit: { key: "shortLinks", max: 5, used: 5 },
        plan: { code: "free", name: "Gratis" },
      }),
    });
  });

  await page.goto("/enlaces");
  const form = page.getByRole("form", { name: "Crear enlace corto" });
  await form.getByLabel("Nombre del enlace").fill(`limite-${Date.now().toString(36)}`);
  await form.getByLabel("Destino").fill("https://ejemplo.cl");
  await form.getByRole("button", { name: "Crear enlace" }).click();

  const aviso = form.getByRole("alert");
  await expect(aviso).toContainText("Llegaste al máximo de enlaces cortos de tu plan.");
  await expect(aviso).toContainText("Plan Gratis: 5 de 5.");
  await aviso.getByRole("link", { name: "Ver planes" }).click();
  await expect(page).toHaveURL(/\/plan$/);
});
