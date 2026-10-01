import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// F7.5 (ADR-020) — secuencias de correo en el panel: crear una desde la plantilla inicial (con la
// validación a la vista), ver el recorrido y la vista previa personalizada, guardar, probar un correo,
// pausar desde la lista, ver a las personas inscritas y detener a una. Teléfono y escritorio.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const CAPTURES = ".playwright/capturas/f75";
const org = `${API_BASE_URL}/organizations/${fixture.organizationId}`;
const prisma = new PrismaClient();

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.afterAll(async () => {
  await prisma.contact.deleteMany({ where: { email: { endsWith: "@secuencias-pw.test" } } });
  await prisma.$disconnect();
});

test("una secuencia se crea, se prueba, se pausa y muestra a sus personas", async ({ page }, testInfo) => {
  const name = `Bienvenida ${testInfo.project.name} ${Date.now().toString(36)}`;
  let sequenceId: string | null = null;
  try {
    await page.goto("/secuencias");
    await expect(page.getByRole("heading", { name: "Secuencias de correo", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Nueva secuencia" }).first().click();
    await expect(page.getByRole("heading", { name: "Nueva secuencia" })).toBeVisible();

    // Sin nombre no se guarda, y el error se dice.
    await page.getByRole("button", { name: "Crear secuencia" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Ponle un nombre" })).toBeVisible();
    await page.getByLabel("Nombre interno").fill(name);

    // Plantilla inicial: dos correos, con su recorrido y la vista previa con el nombre de ejemplo.
    const timeline = page.getByRole("list", { name: "Recorrido de la secuencia" });
    await expect(timeline).toContainText("Al instante");
    await expect(timeline).toContainText("A los 3 días");
    await expect(page.getByText("Asunto: ¡Bienvenida, Ana!")).toBeVisible();
    await page.getByRole("button", { name: "Agregar correo" }).click();
    const third = page.locator('[data-sequence-step="2"]');
    await third.getByLabel("Asunto").fill("Una oferta para ti, {{nombre}}");
    await third.getByRole("textbox", { name: "Mensaje del correo 3" }).click();
    await page.keyboard.type("Hola {{nombre}}, este mes tienes un 10 % de descuento.");
    await expect(timeline).toContainText("A los 5 días");
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/editor-${testInfo.project.name}.png`, fullPage: true });

    await page.getByRole("button", { name: "Crear secuencia" }).click();
    await page.waitForURL(/\/secuencias\/[0-9a-f-]{36}$/);
    sequenceId = page.url().split("/").at(-1)!;
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();

    // Probar un correo guardado.
    await page.locator('[data-sequence-step="0"]').getByRole("button", { name: "Probar" }).click();
    await expect(page.getByRole("status")).toContainText("Te enviamos el correo 1");

    // En la lista: pausar y ver a las personas.
    const contact = await prisma.contact.create({
      data: { organizationId: fixture.organizationId, name: "Rosa Díaz", email: `rosa-${testInfo.project.name}-${Date.now().toString(36)}@secuencias-pw.test`, marketingConsentAt: new Date() },
    });
    await prisma.emailSequenceEnrollment.create({
      data: { organizationId: fixture.organizationId, sequenceId, contactId: contact.id, eventKey: `pw-${contact.id}`, nextSendAt: new Date(Date.now() + 3 * 86_400_000) },
    });
    await page.goto("/secuencias");
    const row = page.getByRole("listitem", { name });
    await expect(row).toContainText("1 en curso");
    await expect(row).toContainText("al instante → 3 días → 5 días");
    const patched = page.waitForResponse((response) => response.url().includes("/email-sequences/") && response.request().method() === "PATCH");
    await row.getByText("Encendida").click();
    expect((await patched).status()).toBe(200);
    await expect(row.getByRole("switch")).not.toBeChecked();
    await expect(row.getByText("Pausada")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/lista-${testInfo.project.name}.png` });

    await row.getByRole("button", { name: "Personas" }).click();
    const dialog = page.getByRole("dialog", { name: /^Personas/ });
    await expect(dialog.getByText("Rosa Díaz")).toBeVisible();
    await expect(dialog.getByText("0 de 3 correos")).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/personas-${testInfo.project.name}.png` });
    await dialog.getByRole("button", { name: "Detener" }).click();
    await dialog.getByRole("button", { name: "Sí", exact: true }).click();
    await expect(dialog.getByText("Detenida por el equipo")).toBeVisible();
  } finally {
    if (sequenceId) await page.request.delete(`${org}/email-sequences/${sequenceId}`, { headers: CSRF });
  }
});
