import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { ADMIN_SESSION_PATH, FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { ADMIN_URL, PUBLIC_WEB_URL } from "../playwright.config.js";

// F10.6 (ADR-029) — marketplace, en teléfono y escritorio: un socio publica una integración, la plataforma la revisa y la aprueba, otra
// persona la instala (con su clave de firma una sola vez) y la quita; al retirarla la plataforma, se desinstala. Lo no aprobado no se ve.

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/f106";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const MOTIVO = "Aprobada tras revisar los eventos y el destino que pide.";

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba.
  await prisma.marketplaceInstall.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.marketplaceListing.deleteMany({ where: { name: { startsWith: "E2E Integración" } } });
  await prisma.webhookEndpoint.deleteMany({ where: { organizationId: fixture.organizationId, description: { startsWith: "Integración: E2E" } } });
  await prisma.auditLog.deleteMany({
    where: { organizationId: fixture.organizationId, OR: [{ targetType: "MarketplaceListing" }, { action: { startsWith: "webhook." } }, { action: { startsWith: "marketplace." } }] },
  });
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

test("publicar, revisar, instalar, desinstalar y retirar", async ({ browser, page }, testInfo) => {
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const name = `E2E Integración ${project} ${suffix}`;

  // --- Socio: publica una integración desde el panel ---
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto("/marketplace");
  await expect(page.getByRole("heading", { name: "Marketplace", exact: true })).toBeVisible();

  const form = page.getByRole("form", { name: "Publicar en el marketplace" });
  await form.getByRole("button", { name: "Enviar a revisión" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "nombre de al menos 3 caracteres" })).toBeVisible();
  await form.getByLabel(/^Nombre/).fill(name);
  await form.getByLabel("Resumen (una línea)").fill("Envía tus contactos nuevos a tu hoja de cálculo.");
  await form.getByLabel("Descripción").fill("Cada contacto nuevo llega como una fila a la herramienta que conectes.");
  await form.getByLabel("Tu nombre como socio").fill("Socio de pruebas");
  await form.getByRole("button", { name: "Enviar a revisión" }).click();
  await expect(form.getByRole("alert").filter({ hasText: "al menos un evento" })).toBeVisible();
  await form.getByRole("checkbox", { name: /Contacto nuevo/ }).check();
  await form.getByRole("button", { name: "Enviar a revisión" }).click();
  await expect(form.getByText("Enviada a revisión.")).toBeVisible();

  const mine = page.getByRole("listitem").filter({ hasText: name });
  await expect(mine.getByText("En revisión")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `01-publicada-${project}.png`);

  // En revisión: no aparece en el directorio ni en la página pública.
  await expect(page.getByRole("form", { name: `Instalar ${name}` })).toHaveCount(0);
  const visitor = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
  const web = await visitor.newPage();
  await web.goto("/integraciones");
  await expect(web.getByRole("heading", { name: "De nuestros socios" })).toBeVisible();
  await expect(web.getByText(name)).toHaveCount(0);

  // --- Administración: la cola, con lo que pide, y aprobar ---
  const adminContext = await browser.newContext({ ...use, baseURL: ADMIN_URL, storageState: ADMIN_SESSION_PATH });
  const admin = await adminContext.newPage();
  await admin.goto("/marketplace");
  await expect(admin.getByRole("heading", { name: "Marketplace" })).toBeVisible();
  const entry = admin.getByRole("listitem").filter({ hasText: name });
  await expect(entry).toBeVisible();
  await expect(entry.getByText(/contacto nuevo/i).first()).toBeVisible();
  await expectNoHorizontalScroll(admin);
  await capture(admin, `02-admin-cola-${project}.png`);
  await entry.getByRole("button", { name: "Aprobar" }).click();
  await expect(admin.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);

  // --- La plataforma ya la muestra; el panel la ofrece para instalar ---
  await web.reload();
  await expect(web.getByText(name)).toBeVisible();
  await capture(web, `03-publico-${project}.png`);

  await page.reload();
  // La tarjeta del directorio (la fila de «Tus publicaciones» no trae «Qué pide»): se identifica por su contenido, no por el formulario.
  const card = page.getByRole("listitem").filter({ hasText: name }).filter({ hasText: "Qué pide" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Qué pide")).toBeVisible();
  const install = page.getByRole("form", { name: `Instalar ${name}` });
  // Sin una dirección de destino válida no se instala.
  await install.getByLabel("Dirección de destino").fill("http://127.0.0.1/hook");
  await install.getByRole("button", { name: "Instalar" }).click();
  await expect(card.getByRole("alert")).toBeVisible();
  await install.getByLabel("Dirección de destino").fill(`https://hooks.zapier.com/hooks/catch/${Date.now()}/${suffix}${project}/`);
  await install.getByRole("button", { name: "Instalar" }).click();
  await expect(card.getByText("Guarda esta clave de firma ahora")).toBeVisible();
  await expect(card.getByText("Instalada", { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `04-instalada-${project}.png`);
  expect(await prisma.webhookEndpoint.count({ where: { organizationId: fixture.organizationId, description: { startsWith: `Integración: ${name}` } } })).toBe(1);

  // Desinstalar: el destino desaparece y se puede volver a instalar.
  await card.getByRole("button", { name: "Desinstalar" }).click();
  await card.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByRole("form", { name: `Instalar ${name}` })).toBeVisible();
  expect(await prisma.webhookEndpoint.count({ where: { organizationId: fixture.organizationId, description: { startsWith: `Integración: ${name}` } } })).toBe(0);

  // --- Retiro de la plataforma: desinstala y desaparece ---
  await page
    .getByRole("form", { name: `Instalar ${name}` })
    .getByLabel("Dirección de destino")
    .fill(`https://hooks.zapier.com/hooks/catch/${Date.now()}/${suffix}${project}b/`);
  await page.getByRole("form", { name: `Instalar ${name}` }).getByRole("button", { name: "Instalar" }).click();
  await expect(page.getByText("Guarda esta clave de firma ahora")).toBeVisible();

  await admin.reload();
  await admin.getByRole("radio", { name: "Aprobadas" }).click();
  const approvedEntry = admin.getByRole("listitem").filter({ hasText: name });
  await expect(approvedEntry).toBeVisible();
  await expect(approvedEntry.getByRole("button", { name: "Retirar y desinstalar" })).toBeDisabled();
  await approvedEntry.getByLabel(/Motivo/).fill(MOTIVO);
  await approvedEntry.getByRole("button", { name: "Retirar y desinstalar" }).click();
  await expect(admin.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
  await capture(admin, `05-admin-retirada-${project}.png`);

  expect(await prisma.webhookEndpoint.count({ where: { organizationId: fixture.organizationId, description: { startsWith: `Integración: ${name}` } } })).toBe(0);
  await page.reload();
  await expect(page.getByRole("form", { name: `Instalar ${name}` })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: name }).getByText("Retirada")).toBeVisible();
  await web.reload();
  await expect(web.getByText(name)).toHaveCount(0);

  await adminContext.close();
  await visitor.close();
});
