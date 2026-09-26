import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";

// F4.7 — dominio propio desde el panel: agregar (el servidor normaliza lo que se pega), ver el
// registro TXT a crear, verificar (sin TXT real queda sin verificar, con un mensaje claro) y quitar;
// sin desplazamiento horizontal en teléfono ni escritorio.

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("agrega un dominio, muestra el TXT a crear, lo intenta verificar y lo quita", async ({ page }) => {
  // Un nombre que nunca va a tener el TXT: la verificación consulta DNS real y debe fallar con un
  // mensaje comprensible (sin TXT, o DNS inalcanzable en un entorno sin red).
  const domain = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.impulza-e2e.cl`;

  await page.goto(`/sitios/${fixture.siteId}`);
  const card = page.getByRole("form", { name: "Agregar dominio propio" });
  await expect(card).toBeVisible();

  // Validación en el cliente antes de enviar.
  await card.getByLabel("Dominio").fill("localhost");
  await card.getByRole("button", { name: "Agregar dominio" }).click();
  await expect(card.getByText(/Escribe un dominio público/)).toBeVisible();

  await card.getByLabel("Dominio").fill(`https://${domain.toUpperCase()}/`);
  await card.getByRole("button", { name: "Agregar dominio" }).click();

  const item = page.locator(`[data-domain="${domain}"]`);
  await expect(item).toBeVisible();
  await expect(item).toContainText("Pendiente de verificar");
  await expect(item).toContainText(`_impulza.${domain}`);
  await expect(item).toContainText(/impulza-verificacion=[a-f0-9]{32}/);
  await expectNoHorizontalScroll(page);

  await item.getByRole("button", { name: "Verificar ahora" }).click();
  await expect(item).toContainText("Sin verificar", { timeout: 15_000 });
  await expect(item.getByText(/registro TXT|DNS/).first()).toBeVisible();

  await item.getByRole("button", { name: "Quitar" }).click();
  await item.getByRole("button", { name: "Sí" }).click();
  await expect(item).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
