import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// F7.2 — Integraciones de punta a punta: se crea un destino desde el panel (con los errores de
// validación del servidor a la vista), el secreto se muestra una vez, un ejemplo de evento pasa por
// el worker real y el registro muestra el intento y su motivo en palabras; pausar, rotar y borrar.
// El destino es un dominio que no existe: el worker lo intenta sin salir a ninguna red interna.
// Teléfono y escritorio.

test.describe.configure({ mode: "serial" });
// Espera al worker real (resolución DNS y reintento): más que el límite por defecto.
test.setTimeout(120_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const CAPTURES = ".playwright/capturas/f72";
const org = `${API_BASE_URL}/organizations/${fixture.organizationId}`;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function removeEndpoints(page: Page, marker: string): Promise<void> {
  const list = (await (await page.request.get(`${org}/webhooks`)).json()) as Array<{ id: string; url: string }>;
  for (const endpoint of list.filter((item) => item.url.includes(marker))) {
    await page.request.delete(`${org}/webhooks/${endpoint.id}`, { headers: CSRF });
  }
}

test("un destino creado en el panel recibe un ejemplo firmado por el worker, con su registro, pausa, rotación y borrado", async ({ page }, testInfo) => {
  const marker = `e2e-f72-${testInfo.project.name}-${Date.now().toString(36)}`;
  const url = `https://${marker}.impulza-webhooks-e2e-nx.com/hooks/catch/123456/abcdefghijklmnopqrstuvwxyz`;

  try {
    await page.goto("/integraciones");
    await expect(page.getByRole("heading", { name: "Integraciones", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cómo conectarlo" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Nuevo destino" }).click();

    const dialog = page.getByRole("dialog", { name: "Nuevo destino" });
    // Una URL local o sin https se rechaza antes de guardar, con el motivo junto al campo.
    await dialog.getByLabel("URL del destino").fill("http://localhost:3000/hook");
    await dialog.getByRole("button", { name: "Crear destino" }).click();
    await expect(dialog.getByText("La dirección tiene que usar https://")).toBeVisible();
    await dialog.getByLabel("URL del destino").fill("https://192.168.1.10/hook");
    await dialog.getByRole("button", { name: "Crear destino" }).click();
    await expect(dialog.getByText("sitio público de internet")).toBeVisible();

    await dialog.getByLabel("URL del destino").fill(url);
    await dialog.getByLabel("Descripción (opcional)").fill(`Zapier ${marker}`);
    await dialog.getByLabel("Pedido pagado").check();
    await dialog.getByLabel("Contacto nuevo").uncheck();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/nuevo-${testInfo.project.name}.png` });
    await dialog.getByRole("button", { name: "Crear destino" }).click();

    // El secreto, una sola vez.
    const secretDialog = page.getByRole("dialog", { name: "Destino creado" });
    await expect(secretDialog).toBeVisible();
    const secret = (await secretDialog.getByTestId("webhook-secret").innerText()).trim();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    await expect(secretDialog.getByText("No lo volverás a ver")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/secreto-${testInfo.project.name}.png` });
    await secretDialog.getByRole("button", { name: "Ya lo guardé" }).click();
    await expect(page.getByText(secret)).toHaveCount(0);

    const card = page.getByRole("listitem", { name: `Zapier ${marker}` });
    await expect(card).toBeVisible();
    await expect(card.getByText("Activo", { exact: true }).first()).toBeVisible();
    await expect(card.getByText(`whsec_…${secret.slice(-4)}`)).toBeVisible();
    await expect(card.getByRole("list", { name: "Eventos" }).getByText("Pedido pagado")).toBeVisible();

    // Un ejemplo de "Pedido pagado": el worker real lo intenta; el dominio no existe.
    await card.getByLabel("Enviar un ejemplo de").selectOption("order.paid");
    await card.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(card.getByText("Enviamos el ejemplo de «Pedido pagado»")).toBeVisible();
    await card.getByRole("button", { name: "Registro" }).click();
    const history = page.getByRole("dialog", { name: /^Registro/ });
    const row = history.getByRole("listitem").filter({ hasText: "Pedido pagado" });
    await expect(row).toBeVisible();
    await expect(row.getByText("No encontramos ese dominio")).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Cuerpo" }).click();
    await expect(row.getByText('"test": true')).toBeVisible();
    await expect(row.getByText('"type": "order.paid"')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/registro-${testInfo.project.name}.png` });
    await history.getByRole("button", { name: "Cerrar" }).click();

    // Pausar: sin envíos de prueba mientras tanto.
    const patched = page.waitForResponse((response) => response.url().includes("/webhooks/") && response.request().method() === "PATCH");
    await card.getByText("Activo", { exact: true }).last().click();
    expect((await patched).status()).toBe(200);
    await expect(card.getByRole("switch")).not.toBeChecked();
    await expect(card.getByRole("button", { name: "Enviar", exact: true })).toBeDisabled();

    // Rotar: un secreto nuevo, también una sola vez.
    await card.getByRole("button", { name: "Rotar secreto" }).click();
    await expect(card.getByText("¿Rotar? El actual deja de valer.")).toBeVisible();
    await card.getByRole("button", { name: "Sí", exact: true }).click();
    const rotated = page.getByRole("dialog", { name: "Secreto nuevo" });
    await expect(rotated).toBeVisible();
    const newSecret = (await rotated.getByTestId("webhook-secret").innerText()).trim();
    expect(newSecret).not.toBe(secret);
    await expect(rotated.getByText("El anterior ya dejó de valer")).toBeVisible();
    await rotated.getByRole("button", { name: "Ya lo guardé" }).click();

    // La guía muestra la forma de cada evento y cómo verificar la firma.
    await page.getByText("Qué trae cada evento").click();
    await page.getByRole("button", { name: "Reserva nueva", exact: true }).click();
    await expect(page.getByText('"type": "booking.created"')).toBeVisible();
    await page.getByText("Verificar que el aviso viene de Impulza").click();
    await expect(page.getByText("createHmac(\"sha256\", secret)")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/lista-${testInfo.project.name}.png`, fullPage: true });

    await card.getByRole("button", { name: "Borrar" }).click();
    await expect(card.getByText("¿Borrar con su registro?")).toBeVisible();
    await card.getByRole("button", { name: "Sí", exact: true }).click();
    await expect(card).toBeHidden();
  } finally {
    await removeEndpoints(page, marker);
  }
});
