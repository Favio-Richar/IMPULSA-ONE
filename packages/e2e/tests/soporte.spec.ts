import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_SESSION_PATH, FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { ADMIN_URL } from "../playwright.config.js";

// F4.5 — soporte mínimo, de punta a punta con las dos sesiones sembradas: el dueño de la
// organización abre una solicitud desde el panel, el equipo la ve en su bandeja de `apps/admin` y
// responde, y el cliente ve la respuesta firmada por el equipo (sin el correo de quien respondió).

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("el formulario valida antes de enviar", async ({ page }) => {
  await page.goto("/soporte/nueva");
  await page.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(page.getByText("El asunto necesita al menos 5 caracteres.")).toBeVisible();
  await expect(page.getByText("Cuéntanos un poco más (al menos 10 caracteres).")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("el cliente abre una solicitud, el equipo responde y el cliente ve la respuesta", async ({ page, browser }, testInfo) => {
  const subject = `No carga mi QR (${testInfo.project.name} ${Date.now().toString(36)})`;

  // Cliente: abre la solicitud.
  await page.goto("/soporte");
  await expect(page.getByRole("heading", { name: "Soporte", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Nueva solicitud" }).first().click();
  await page.getByLabel("Asunto").fill(subject);
  await page.getByLabel("Detalle").fill("El código QR del volante no abre la carta cuando lo escaneo con el teléfono.");
  await page.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  await expect(page.getByText("Esperando respuesta")).toBeVisible();
  const ticketUrl = page.url();
  await expectNoHorizontalScroll(page);

  // Equipo: la encuentra en la bandeja "Sin responder" y responde.
  const staff = await browser.newContext({ baseURL: ADMIN_URL, storageState: ADMIN_SESSION_PATH });
  const staffPage = await staff.newPage();
  await staffPage.goto(`/soporte?organizationId=${fixture.organizationId}`);
  await staffPage.getByRole("link", { name: new RegExp(subject.replace(/[()]/g, "\\$&")) }).click();
  await staffPage.getByLabel("Respuesta al cliente").fill("Lo revisamos: el QR apuntaba a una dirección antigua. Ya quedó corregido.");
  await staffPage.getByRole("button", { name: "Enviar respuesta" }).click();
  await expect(staffPage.getByText("Esperando al cliente")).toBeVisible();
  await expect(staffPage.getByRole("list", { name: "Conversación" }).getByText(fixture.adminEmail)).toBeVisible();
  await expectNoHorizontalScroll(staffPage);
  await staff.close();

  // Cliente: ve la respuesta firmada por el equipo, sin el correo de quien respondió.
  await page.goto(ticketUrl);
  await expect(page.getByText("Respondida")).toBeVisible();
  await expect(page.getByText("Equipo de Impulza One")).toBeVisible();
  await expect(page.getByText("Ya quedó corregido.", { exact: false })).toBeVisible();
  await expect(page.getByText(fixture.adminEmail)).toHaveCount(0);

  // Y en la lista aparece con su estado.
  await page.goto("/soporte");
  await expect(page.getByRole("link", { name: new RegExp(subject.replace(/[()]/g, "\\$&")) })).toContainText("Respondida");
  await expectNoHorizontalScroll(page);
});
