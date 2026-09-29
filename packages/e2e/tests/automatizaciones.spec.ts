import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// F6.7 — automatizaciones de punta a punta: se crea una desde el panel, un contacto nuevo la dispara,
// el worker real la ejecuta desde la cola (el contacto queda etiquetado) y el registro lo muestra.
// Apagada, un contacto nuevo ya no la dispara. Teléfono y escritorio.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const CAPTURES = ".playwright/capturas/f67";
const org = `${API_BASE_URL}/organizations/${fixture.organizationId}`;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function contactTags(page: Page, contactId: string): Promise<string[]> {
  return ((await (await page.request.get(`${org}/contacts/${contactId}`)).json()) as { tags: string[] }).tags;
}

test("una automatización creada en el panel etiqueta de verdad a un contacto nuevo y lo deja en el registro", async ({ page }, testInfo) => {
  const tag = `e2e-f67-${testInfo.project.name}-${Date.now().toString(36)}`;
  const created: string[] = [];
  let automationId: string | null = null;

  try {
    await page.goto("/automatizaciones");
    await expect(page.getByRole("heading", { name: "Automatizaciones", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Nueva automatización" }).click();
    const dialog = page.getByRole("dialog", { name: "Nueva automatización" });
    await dialog.getByLabel("Cuando").selectOption("contact_created");
    await dialog.getByLabel("Entonces").selectOption("tag_contact");
    await dialog.getByRole("button", { name: "Crear automatización" }).click();
    await expect(dialog.getByText("Escribe la etiqueta")).toBeVisible();
    await dialog.getByLabel("Etiqueta").fill(tag);
    await expect(dialog.getByText("Escribe la etiqueta")).toBeHidden();
    await expect(dialog.getByText(`Llega un contacto nuevo → Etiquetar al contacto con «${tag}»`)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/nueva-${testInfo.project.name}.png` });
    await dialog.getByRole("button", { name: "Crear automatización" }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole("listitem").filter({ hasText: tag });
    await expect(row).toBeVisible();
    await expect(row.getByText("todavía no se ejecuta")).toBeVisible();
    // Sin nombre propio, la regla se lee una sola vez.
    expect((await row.innerText()).split(tag).length - 1).toBe(1);
    const list = (await (await page.request.get(`${org}/automations`)).json()) as Array<{ id: string; name: string }>;
    automationId = list.find((item) => item.name.includes(tag))!.id;

    // Un contacto nuevo la dispara; el worker real la ejecuta desde la cola.
    const contact = (await (await page.request.post(`${org}/contacts`, { headers: CSRF, data: { name: "Contacto automatizado" } })).json()) as { id: string };
    created.push(contact.id);
    await expect.poll(() => contactTags(page, contact.id), { timeout: 20_000 }).toContain(tag);

    await page.reload();
    await expect(row.getByText(/1 hecha/)).toBeVisible();
    await row.getByRole("button", { name: "Registro" }).click();
    const history = page.getByRole("dialog", { name: /^Registro/ });
    await expect(history.getByText("Hecha")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${CAPTURES}/registro-${testInfo.project.name}.png` });
    await history.getByRole("button", { name: "Cerrar" }).click();

    // Apagada: un contacto nuevo ya no se etiqueta.
    const patched = page.waitForResponse((response) => response.url().endsWith(`/automations/${automationId}`) && response.request().method() === "PATCH");
    // Como una persona: clic sobre el interruptor visible (la etiqueta), no sobre el campo oculto.
    await expect(row.getByRole("switch")).toBeChecked();
    await row.getByText("Encendida").click();
    const patchResponse = await patched;
    expect(patchResponse.status(), await patchResponse.text()).toBe(200);
    await expect(row.getByRole("switch")).not.toBeChecked();
    await expect(row.getByText("Apagada")).toBeVisible();
    const later = (await (await page.request.post(`${org}/contacts`, { headers: CSRF, data: { name: "Después de apagar" } })).json()) as { id: string };
    created.push(later.id);
    await page.waitForTimeout(3000);
    expect(await contactTags(page, later.id)).not.toContain(tag);
    await page.screenshot({ path: `${CAPTURES}/lista-${testInfo.project.name}.png`, fullPage: true });
  } finally {
    if (automationId) {
      await page.request.delete(`${org}/automations/${automationId}`, { headers: CSRF });
    }
    for (const id of created) {
      await page.request.delete(`${org}/contacts/${id}`, { headers: CSRF });
    }
  }
});
