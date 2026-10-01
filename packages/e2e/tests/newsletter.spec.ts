import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F7.4 (ADR-019) — newsletter de punta a punta en el build de producción: el bloque publicado valida
// el correo y la casilla, envía y muestra "Revisa tu correo" (sin crear el contacto); la página del
// enlace muestra a quién corresponde, confirma con un clic y el contacto queda con su consentimiento.
// El correo en desarrollo va a la consola: la solicitud a confirmar se crea con un token conocido.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one" };
const site = `${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}`;
const blocksPath = `${site}/pages/${fixture.pageId}/blocks`;
const CAPTURES = ".playwright/capturas/f74";

const prisma = new PrismaClient();
let api: APIRequestContext;
let blockId = "";

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function revalidate(): Promise<void> {
  const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, { headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET }, data: { siteSlug: fixture.siteSlug } });
  expect(response.status()).toBe(200);
}

test.beforeAll(async () => {
  api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  const created = await api.post(blocksPath, {
    headers: CSRF,
    data: { type: "newsletter", config: { title: "Novedades del estudio", description: "Un correo al mes con lo nuevo. Sin spam.", askName: true, buttonLabel: "Quiero recibirlas" } },
  });
  expect(created.status(), await created.text()).toBe(201);
  blockId = ((await created.json()) as { id: string }).id;
  expect((await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF })).status()).toBe(201);
  await revalidate();
});

test.afterAll(async () => {
  await api.delete(`${blocksPath}/${blockId}`, { headers: CSRF });
  await api.post(`${site}/pages/${fixture.pageId}/publish`, { headers: CSRF });
  await revalidate();
  await prisma.newsletterConfirmation.deleteMany({ where: { email: { endsWith: "@newsletter-pw.test" } } });
  await prisma.contact.deleteMany({ where: { email: { endsWith: "@newsletter-pw.test" } } });
  await prisma.$disconnect();
  await api.dispose();
});

test("el bloque publicado valida, envía y pide revisar el correo, sin crear todavía el contacto", async ({ page }, testInfo) => {
  const email = `pide-${testInfo.project.name}-${Date.now().toString(36)}@newsletter-pw.test`;
  await page.goto(`${PUBLIC_WEB_URL}/${fixture.siteSlug}`);
  const block = page.locator("[data-newsletter]");
  await expect(block.getByRole("heading", { name: "Novedades del estudio" })).toBeVisible();
  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${CAPTURES}/bloque-${testInfo.project.name}.png` });

  // Sin casilla: el error se dice y se asocia, sin enviar nada.
  await block.getByLabel("Correo", { exact: true }).fill(email.toUpperCase());
  await block.getByRole("button", { name: "Quiero recibirlas" }).click();
  await expect(block.getByRole("alert")).toContainText("Marca la casilla");
  await expect(block.getByRole("checkbox")).not.toBeChecked();

  await block.getByLabel("Nombre (opcional)").fill("Ana");
  await block.getByRole("checkbox").check();
  const sent = page.waitForResponse((response) => response.url().includes("/api/newsletter/") && response.request().method() === "POST");
  await block.getByRole("button", { name: "Quiero recibirlas" }).click();
  expect((await sent).status()).toBe(202);
  await expect(block.getByRole("status")).toContainText("Revisa tu correo");
  await expect(block.getByRole("status")).toBeFocused();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/enviado-${testInfo.project.name}.png` });

  const pending = await prisma.newsletterConfirmation.findFirstOrThrow({ where: { email } });
  expect(pending).toMatchObject({ name: "Ana", confirmedAt: null, siteId: fixture.siteId });
  expect(await prisma.contact.count({ where: { organizationId: fixture.organizationId, email } })).toBe(0);
});

test("el enlace muestra a quién corresponde, confirma con un clic y el contacto queda suscrito", async ({ page }, testInfo) => {
  const email = `confirma-${testInfo.project.name}-${Date.now().toString(36)}@newsletter-pw.test`;
  const token = randomBytes(32).toString("base64url");
  await prisma.newsletterConfirmation.create({
    data: {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      email,
      name: "Rosa",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      consentTextVersion: "newsletter-v1",
      expiresAt: new Date(Date.now() + 48 * 3_600_000),
    },
  });

  await page.goto(`${PUBLIC_WEB_URL}/suscripcion/${token}`);
  await expect(page.getByRole("heading", { name: "Confirma tu suscripción" })).toBeVisible();
  await expect(page.getByText(/co•••@newsletter-pw\.test/)).toBeVisible();
  // Abrir no confirma.
  expect(await prisma.contact.count({ where: { organizationId: fixture.organizationId, email } })).toBe(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `${CAPTURES}/confirmar-${testInfo.project.name}.png` });

  await page.getByRole("button", { name: "Confirmar suscripción" }).click();
  await expect(page.getByRole("heading", { name: "¡Listo, ya estás suscrito!" })).toBeFocused();
  await page.screenshot({ path: `${CAPTURES}/confirmado-${testInfo.project.name}.png` });
  const contact = await prisma.contact.findFirstOrThrow({ where: { organizationId: fixture.organizationId, email } });
  expect(contact).toMatchObject({ name: "Rosa", marketingUnsubscribedAt: null, tags: ["newsletter"], marketingConsentSource: `newsletter:${fixture.siteId}:double_opt_in` });

  // Recargar muestra el estado confirmado; un enlace inventado da 404.
  await page.reload();
  await expect(page.getByRole("heading", { name: "¡Listo, ya estás suscrito!" })).toBeVisible();
  const missing = await page.goto(`${PUBLIC_WEB_URL}/suscripcion/${randomBytes(32).toString("base64url")}`);
  expect(missing?.status()).toBe(404);
});
