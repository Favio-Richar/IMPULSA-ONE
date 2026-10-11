import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// F9.7a — marca blanca de la agencia (ADR-028 §4), en teléfono y escritorio: la agencia configura su marca (con validación de contraste),
// la activa para un cliente, y el panel de ese cliente se viste con ella; al desactivarla vuelve a la de la plataforma.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = ".playwright/capturas/f97";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let previousPlanId: string | null = null;

test.beforeAll(async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } });
  previousPlanId = org.planId;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id, kind: "BUSINESS" } });
});

test.afterAll(async () => {
  await prisma.agencyClient.deleteMany({ where: { agencyOrganizationId: fixture.organizationId } });
  await prisma.whiteLabelSettings.deleteMany({ where: { agencyOrganizationId: fixture.organizationId } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `wl-pw-${suffix}` } } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId, kind: "BUSINESS" } });
  await prisma.$disconnect();
});

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function capture(page: Page, file: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({ path: `${CAPTURES}/${file}`, fullPage: true });
  await page.emulateMedia({ reducedMotion: null });
}

async function activateOrg(page: Page, organizationId: string): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, organizationId);
}

test("la agencia configura su marca, la activa en un cliente y el panel del cliente se viste con ella", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const brandName = `Estudio Norte ${project} ${suffix}`;
  const clientName = `Cliente Marca ${project} ${suffix}`;

  const owner = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  const orgPath = `${API_BASE_URL}/organizations/${fixture.organizationId}`;
  expect((await owner.post(`${orgPath}/agency/enable`)).status()).toBe(200);
  const created = await owner.post(`${orgPath}/agency/clients`, {
    data: { name: clientName, slug: `wl-pw-${suffix}-${project}`, ownerEmail: `wl-dueno-${project}-${suffix}@e2e.test` },
  });
  expect(created.status()).toBe(201);
  const client = (await created.json()) as { id: string; clientOrganizationId: string };

  // --- La agencia configura su marca ---
  await activateOrg(page, fixture.organizationId);
  await page.goto("/agencia/marca");
  await expect(page.getByRole("heading", { name: "Marca blanca", level: 1 })).toBeVisible();
  const form = page.getByTestId("white-label-form");
  await expect(form).toBeVisible();
  // Sin nombre guardado no se puede activar en un cliente.
  const row = page.getByTestId("white-label-client").filter({ hasText: clientName });
  await expect(row.getByRole("button", { name: "Activar" })).toBeDisabled();

  // Un color sin contraste suficiente se señala antes de guardar.
  await form.getByLabel("Color principal").fill("#ffff99");
  await expect(form.getByText(/Contraste insuficiente/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Guardar marca" })).toBeDisabled();
  await expectNoHorizontalScroll(page);
  await capture(page, `01-marca-blanca-contraste-${project}.png`);

  await form.getByLabel("Nombre de tu marca").fill(brandName);
  await form.getByLabel("Color principal").fill("#0f6f6b");
  await form.getByLabel("Color secundario").fill("#0b5450");
  await form.getByLabel("Correo de soporte").fill("soporte@norte.test");
  await form.getByLabel("Texto del pie").fill("Panel preparado por Estudio Norte");
  await expect(page.getByTestId("white-label-preview")).toContainText(brandName);
  await form.getByRole("button", { name: "Guardar marca" }).click();
  await expect(form.getByText("Marca guardada.")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `02-marca-blanca-guardada-${project}.png`);

  // --- La activa para un cliente ---
  await expect(row.getByRole("button", { name: "Activar" })).toBeEnabled();
  await row.getByRole("button", { name: "Activar" }).click();
  await expect(row.getByRole("button", { name: "Desactivar" })).toBeVisible();
  await capture(page, `03-marca-blanca-cliente-activo-${project}.png`);

  // --- El panel del cliente (con la sesión de la agencia, acceso delegado) lleva la marca de la agencia ---
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, client.clientOrganizationId);
  await page.goto("/");
  const root = page.getByTestId("panel-root");
  await expect(root).toHaveAttribute("data-brand", "white-label");
  await expect(page.locator("aside").first()).toContainText(brandName);
  await expect(page.getByTestId("panel-brand-footer")).toContainText("Panel preparado por Estudio Norte");
  await expect(page.getByTestId("panel-brand-footer")).toContainText("soporte@norte.test");
  await expectNoHorizontalScroll(page);
  await capture(page, `04-panel-cliente-marca-blanca-${project}.png`);

  // --- Desactivarla devuelve el panel a la marca de la plataforma ---
  expect((await owner.put(`${orgPath}/agency/white-label/clients/${client.id}`, { data: { enabled: false } })).status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId("panel-root")).toHaveAttribute("data-brand", "platform");
  await expect(page.getByTestId("panel-brand-footer")).toHaveCount(0);
  await owner.dispose();
});
