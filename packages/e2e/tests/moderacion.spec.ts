import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { ADMIN_SESSION_PATH, FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { ADMIN_URL, API_BASE_URL, DASHBOARD_URL, PUBLIC_WEB_REVALIDATE_SECRET, PUBLIC_WEB_URL } from "../playwright.config.js";

// F9.9d (ADR-028 §7) — moderación de punta a punta, en teléfono y escritorio: un visitante reporta una página pública; el equipo
// lo revisa en la administración y despublica el sitio con motivo; el propietario lo ve en su panel con la explicación y apela;
// el equipo restaura y el sitio vuelve a servirse. Nada se despublica solo.

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = "../../docs/design/capturas/f99";
const prisma = new PrismaClient();
const REASON = "Verificamos que el sitio ofrece productos inexistentes.";
const APPEAL = "Los productos existen y tengo las facturas; pido que se revise la medida.";

test.afterAll(async () => {
  await prisma.abuseReport.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.site.update({ where: { id: fixture.siteId }, data: { moderationHiddenAt: null } });
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

async function publicStatus(path: string): Promise<number> {
  const api = await apiRequest.newContext();
  try {
    return (await api.get(`${PUBLIC_WEB_URL}${path}`, { maxRedirects: 0, failOnStatusCode: false })).status();
  } finally {
    await api.dispose();
  }
}

/** El sitio público está en caché: se invalida por la vía oficial, igual que lo hace la API tras una decisión. */
async function revalidate(): Promise<void> {
  const api = await apiRequest.newContext();
  try {
    const response = await api.post(`${PUBLIC_WEB_URL}/api/revalidate`, {
      headers: { "x-revalidate-secret": PUBLIC_WEB_REVALIDATE_SECRET },
      data: { siteSlug: fixture.siteSlug },
    });
    expect(response.status()).toBe(200);
  } finally {
    await api.dispose();
  }
}

test("un visitante reporta la página desde su pie, con validación y confirmación accesibles", async ({ browser }, testInfo) => {
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;

  // El sitio necesita una página publicada para servirse en `apps/web`.
  const owner = await apiRequest.newContext({ storageState: "./.playwright/session.json", extraHTTPHeaders: CSRF });
  const publish = await owner.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/sites/${fixture.siteId}/pages/${fixture.pageId}/publish`);
  expect([200, 201]).toContain(publish.status());
  await owner.dispose();
  await revalidate();

  // Un visitante distinto por proyecto: la API no guarda dos reportes del mismo visitante sobre el mismo sitio en 24 h.
  const visitorIp = project === "movil" ? "198.51.100.21" : "198.51.100.22";
  const context = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL, extraHTTPHeaders: { "x-real-ip": visitorIp } });
  const page = await context.newPage();
  await page.goto(`/${fixture.siteSlug}`);

  const link = page.getByRole("link", { name: "Reportar esta página" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/reportar/${fixture.siteSlug}$`));
  await expect(page.getByRole("heading", { name: "Reportar esta página" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `01-reportar-${project}.png`);

  // Sin motivo no se envía y el error se anuncia.
  await page.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Elige un motivo." })).toBeVisible();

  // «Otro» exige una explicación mínima.
  await page.getByLabel("Otro motivo").check();
  await page.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(page.getByText(/al menos 10 caracteres/)).toBeVisible();

  // Un correo inválido se señala junto al campo.
  await page.getByLabel("Fraude o estafa").check();
  await page.getByLabel("Tu correo").fill("no-es-correo");
  await page.getByRole("button", { name: "Enviar reporte" }).click();
  await expect(page.getByText("Escribe un correo válido o déjalo vacío.")).toBeVisible();
  await capture(page, `02-reportar-errores-${project}.png`);

  await page.getByLabel("Tu correo").fill("");
  await page.getByLabel(/Cuéntanos más/).fill(`Texto de prueba e2e (${project})`);
  await page.getByRole("button", { name: "Enviar reporte" }).click();
  const done = page.getByRole("heading", { name: "Gracias, recibimos tu reporte" });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
  await expect(page.getByText(/Ninguna página se despublica de forma automática/)).toBeVisible();
  await capture(page, `03-reportar-enviado-${project}.png`);

  // El reporte quedó guardado y el sitio sigue servido: un reporte nunca despublica nada por sí solo.
  expect(await prisma.abuseReport.count({ where: { siteId: fixture.siteId } })).toBeGreaterThanOrEqual(1);
  expect(await publicStatus(`/${fixture.siteSlug}`)).toBe(200);
  await context.close();
});

test("un sitio inexistente no ofrece el formulario", async () => {
  expect(await publicStatus("/reportar/no-existe-jamas-e2e")).toBe(404);
});

test("el equipo despublica con motivo, el propietario apela con la medida vigente y el equipo restaura", async ({ browser, page }, testInfo) => {
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const report = await prisma.abuseReport.create({
    data: { organizationId: fixture.organizationId, siteId: fixture.siteId, reason: "FRAUD", details: `Reporte de prueba e2e (${project})`, reporterEmail: "denunciante@e2e.test" },
  });

  // --- Administración: la cola, el detalle y la decisión con motivo y confirmación ---
  const adminContext = await browser.newContext({ ...use, baseURL: ADMIN_URL, storageState: ADMIN_SESSION_PATH });
  const admin = await adminContext.newPage();
  await admin.goto("/moderacion");
  await expect(admin.getByRole("heading", { name: "Moderación" })).toBeVisible();
  await expect(admin.getByRole("link", { name: /Fraude o estafa · Sitio e2e/ }).first()).toBeVisible();
  await expectNoHorizontalScroll(admin);
  await capture(admin, `04-admin-cola-${project}.png`);

  await admin.goto(`/moderacion/${report.id}`);
  await expect(admin.getByText(`Reporte de prueba e2e (${project})`)).toBeVisible();
  await expect(admin.getByText(/denunciante@e2e\.test/)).toBeVisible();
  await expectNoHorizontalScroll(admin);

  await admin.getByRole("radio", { name: "Despublicar el sitio" }).check();
  // Sin motivo no avanza.
  await admin.getByRole("button", { name: "Despublicar el sitio" }).click();
  await expect(admin.getByText("Explica el motivo (al menos 5 caracteres).")).toBeVisible();
  await admin.getByRole("textbox", { name: "Motivo" }).fill(REASON);
  await admin.getByRole("button", { name: "Despublicar el sitio" }).click();
  // Acción visible para un tercero: pide una segunda confirmación.
  await expect(admin.getByText(/sobre un negocio real/)).toBeVisible();
  await capture(admin, `05-admin-confirmar-${project}.png`);
  await admin.getByRole("button", { name: "Sí, aplicar" }).click();
  await expect(admin.getByText("Despublicado por moderación")).toBeVisible();
  await expect(admin.getByText(REASON).first()).toBeVisible();
  await capture(admin, `06-admin-despublicado-${project}.png`);

  await revalidate();
  expect(await publicStatus(`/${fixture.siteSlug}`)).toBe(404);
  expect(await publicStatus(`/reportar/${fixture.siteSlug}`)).toBe(404);

  // --- Panel del propietario: ve la medida con la explicación y apela ---
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto(`${DASHBOARD_URL}/configuracion/moderacion`);
  await expect(page.getByRole("heading", { name: "Página despublicada" })).toBeVisible();
  await expect(page.getByText(REASON)).toBeVisible();
  // Nada del reporte ni de quien denunció.
  await expect(page.getByText("denunciante@e2e.test")).toHaveCount(0);
  await expect(page.getByText(`Reporte de prueba e2e (${project})`)).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await capture(page, `07-propietario-medida-${project}.png`);

  await page.getByRole("button", { name: "Apelar esta medida" }).click();
  await page.getByLabel("¿Por qué crees que la medida no corresponde?").fill("muy corto");
  await page.getByRole("button", { name: "Enviar apelación" }).click();
  await expect(page.getByText(/al menos 20 caracteres/)).toBeVisible();
  await page.getByLabel("¿Por qué crees que la medida no corresponde?").fill(APPEAL);
  await page.getByRole("button", { name: "Enviar apelación" }).click();
  await expect(page.getByText("Apelación en revisión")).toBeVisible();
  await expect(page.getByText(/La medida sigue vigente mientras tanto/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apelar esta medida" })).toHaveCount(0);
  await capture(page, `08-propietario-apelada-${project}.png`);
  // La medida sigue vigente durante la revisión.
  expect(await publicStatus(`/${fixture.siteSlug}`)).toBe(404);

  // --- Administración: ve la apelación, restaura con motivo y el sitio vuelve ---
  await admin.reload();
  await expect(admin.getByText("Apelación del propietario")).toBeVisible();
  await expect(admin.getByText(APPEAL)).toBeVisible();
  await expect(admin.getByRole("radio", { name: "Mantener la medida" })).toBeVisible();
  await admin.getByRole("radio", { name: "Restaurar" }).check();
  await admin.getByRole("textbox", { name: "Motivo" }).fill("Apelación aceptada: la documentación respalda al negocio.");
  await admin.getByRole("button", { name: "Restaurar" }).click();
  await expect(admin.getByText("Este caso está cerrado.")).toBeVisible();
  await expect(admin.getByText("Visible al público")).toBeVisible();
  await capture(admin, `09-admin-restaurado-${project}.png`);
  await adminContext.close();

  await revalidate();
  expect(await publicStatus(`/${fixture.siteSlug}`)).toBe(200);

  // El propietario ve la medida retirada y su apelación.
  await page.reload();
  await expect(page.getByText("Medida retirada")).toBeVisible();
  await capture(page, `10-propietario-retirada-${project}.png`);
});
