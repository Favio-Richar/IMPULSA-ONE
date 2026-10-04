import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { Redis } from "ioredis";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { API_BASE_URL } from "../playwright.config.js";

// F9.5d — importar clientes por CSV (ADR-028 §2), en teléfono y escritorio. El servidor valida el archivo fila por fila, el worker real
// crea los clientes por la cola y el avance se ve en pantalla. Se comprueban el informe, las descargas (con las fórmulas neutralizadas),
// que reimportar no duplica, que un archivo en Windows-1252 conserva sus tildes y que un archivo inservible no crea nada.

test.describe.configure({ mode: "serial" });

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CSRF = { "X-Requested-With": "impulza-one", "Content-Type": "application/json" };
const CAPTURES = ".playwright/capturas/f95";
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const suffix = Date.now().toString(36);
const HEADER = "nombre;identificador;correo_del_propietario;quien_paga";

let previousPlanId: string | null = null;

test.beforeAll(async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: fixture.organizationId }, select: { planId: true } });
  previousPlanId = org.planId;
  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: "agencia" } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: plan.id, kind: "BUSINESS" } });
  const api = await apiRequest.newContext({ storageState: "./.playwright/session.json" });
  expect((await api.post(`${API_BASE_URL}/organizations/${fixture.organizationId}/agency/enable`, { headers: CSRF })).status()).toBe(200);
  await api.dispose();
});

// Se sube varias veces en teléfono y escritorio, y el límite es de 5 archivos por minuto: cada prueba parte con el cupo entero.
test.beforeEach(async () => {
  const keys = await redis.keys("ratelimit:agency-client-import*");
  if (keys.length > 0) await redis.del(...keys);
});

test.afterAll(async () => {
  await prisma.agencyImport.deleteMany({ where: { agencyOrganizationId: fixture.organizationId } });
  await prisma.agencyClient.deleteMany({ where: { agencyOrganizationId: fixture.organizationId } });
  await prisma.organization.deleteMany({ where: { slug: { startsWith: `imp-pw-${suffix}` } } });
  await prisma.organization.update({ where: { id: fixture.organizationId }, data: { planId: previousPlanId, kind: "BUSINESS" } });
  await prisma.$disconnect();
  redis.disconnect();
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

async function openImport(page: Page): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto("/agencia");
  await expect(page.getByRole("heading", { name: "Agencia", level: 1 })).toBeVisible();
  // Sin clientes el bloque de alta viene abierto y con clientes, plegado: se abre solo si hace falta.
  const section = page.locator("details").filter({ hasText: "Dar de alta o vincular un cliente" }).first();
  if (!(await section.evaluate((element) => (element as HTMLDetailsElement).open))) await section.locator(":scope > summary").click();
  await expect(page.getByTestId("client-import")).toBeVisible();
}

async function waitUntilDone(page: Page): Promise<void> {
  await expect(page.getByTestId("import-status")).toHaveText("Terminó.", { timeout: 60_000 });
}

test("la plantilla se descarga como CSV, con BOM y con el encabezado que se espera", async ({ page }) => {
  await openImport(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar la plantilla" }).click()]);
  expect(download.suggestedFilename()).toBe("plantilla-clientes.csv");
  const path = await download.path();
  const text = readFileSync(path, "utf8");
  expect(text.startsWith("\uFEFF")).toBe(true);
  expect(text).toContain("nombre;identificador;correo_del_propietario;quien_paga");
  expect(text).toContain("Café del Sol");
});

test("sube un archivo con filas buenas y malas: el avance se ve, el informe señala cada problema y reimportar no duplica", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const project = testInfo.project.name;
  const slug = (label: string) => `imp-pw-${suffix}-${project}-${label}`;
  const owners = ["uno", "dos", "tres"].map((label) => `${label}-${project}-${suffix}@propietarios.test`);
  const file = [
    HEADER,
    `Café Uno;${slug("uno")};${owners[0]};cliente`,
    `=HYPERLINK("http://malo.test");NO VALIDO;a@b.cl;`,
    `Taller Dos;${slug("dos")};${owners[1]};agencia`,
    `Correo malo;${slug("malo")};no-es-un-correo;`,
    `Taller Tres;${slug("tres")};${owners[2]};`,
  ].join("\r\n");

  await openImport(page);
  await page.getByLabel("Archivo CSV").setInputFiles({ name: "clientes.csv", mimeType: "text/csv", buffer: Buffer.from(file, "utf8") });
  await expectNoHorizontalScroll(page);
  await capture(page, `13-importar-archivo-elegido-${project}.png`);
  await page.getByRole("button", { name: "Importar clientes" }).click();

  // El avance aparece de inmediato y el worker real lo lleva hasta el final.
  await expect(page.getByTestId("import-progress")).toBeVisible();
  await waitUntilDone(page);
  await expect(page.getByTestId("import-counts")).toHaveText("5 de 5 filas · 3 creadas · 0 ya existían · 2 con problema");
  await expect(page.getByRole("progressbar", { name: "Avance de la importación" })).toHaveAttribute("aria-valuenow", "100");

  // Cada fila con problema dice qué le pasa, con la línea del archivo.
  const problems = page.getByTestId("import-problem");
  await expect(problems).toHaveCount(2);
  await expect(problems.nth(0)).toContainText("Línea 3");
  await expect(problems.nth(0)).toContainText("El identificador debe tener de 3 a 63 caracteres");
  await expect(problems.nth(1)).toContainText("Línea 5");
  await expect(problems.nth(1)).toContainText("El correo del propietario no es válido");
  await expectNoHorizontalScroll(page);
  await capture(page, `14-importar-informe-${project}.png`);

  // Los tres clientes buenos existen de verdad, invitados y en el panel.
  const created = await prisma.organization.findMany({ where: { slug: { startsWith: `imp-pw-${suffix}-${project}-` } }, orderBy: { slug: "asc" } });
  expect(created.map((org) => org.name).sort()).toEqual(["Café Uno", "Taller Dos", "Taller Tres"]);
  const relations = await prisma.agencyClient.findMany({ where: { agencyOrganizationId: fixture.organizationId, clientOrganization: { slug: { startsWith: `imp-pw-${suffix}-${project}-` } } } });
  expect(relations).toHaveLength(3);
  expect(relations.every((relation) => relation.status === "INVITED" && relation.agencyCreated)).toBe(true);
  expect(relations.map((relation) => relation.billingMode).sort()).toEqual(["AGENCY_PAYS", "CLIENT_PAYS", "CLIENT_PAYS"]);
  await page.getByLabel("Buscar cliente").fill(`imp-pw-${suffix}-${project}`);
  await expect(page.locator("[data-client-slug]")).toHaveCount(3);

  // El informe de errores se descarga como CSV seguro: con la línea del archivo y la fórmula neutralizada.
  const [errorsDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar el informe de errores (CSV)" }).click()]);
  expect(errorsDownload.suggestedFilename()).toBe("errores-importacion.csv");
  const report = readFileSync(await errorsDownload.path(), "utf8");
  expect(report.startsWith("\uFEFF")).toBe(true);
  const lines = report.replace(/^\uFEFF/, "").trim().split("\r\n");
  expect(lines[0]).toBe("fila;nombre;identificador;correo_del_propietario;problema");
  expect(lines[1]).toContain("3;");
  expect(lines[1]).toContain("'=HYPERLINK");
  expect(lines[1]).not.toMatch(/^3;=/);
  expect(lines).toHaveLength(3);

  // Subir el MISMO archivo otra vez no duplica: los tres «ya existían» y las dos filas malas siguen siendo malas.
  await page.getByLabel("Archivo CSV").setInputFiles({ name: "clientes.csv", mimeType: "text/csv", buffer: Buffer.from(file, "utf8") });
  await page.getByRole("button", { name: "Importar clientes" }).click();
  await expect(page.getByTestId("import-counts")).toHaveText("5 de 5 filas · 0 creadas · 3 ya existían · 2 con problema", { timeout: 60_000 });
  await waitUntilDone(page);
  expect(await prisma.organization.count({ where: { slug: { startsWith: `imp-pw-${suffix}-${project}-` } } })).toBe(3);
  // Las dos importaciones quedan en «Importaciones anteriores» (plegado), con sus resultados.
  const history = page.getByTestId("import-history").locator("li");
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText("0 creadas, 2 con problema");
  await expect(history.nth(1)).toContainText("3 creadas, 2 con problema");
});

test("un archivo guardado por Excel en Windows (no UTF-8) conserva sus tildes y eñes", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const project = testInfo.project.name;
  const slug = `imp-pw-${suffix}-${project}-ansi`;
  // «Ñandú» y «Pañalería José» en Windows-1252: bytes que no son UTF-8 válido.
  const file = [HEADER, `Pañalería José;${slug};jose-${project}-${suffix}@propietarios.test;`].join("\r\n");
  await openImport(page);
  await page.getByLabel("Archivo CSV").setInputFiles({ name: "excel.csv", mimeType: "text/csv", buffer: Buffer.from(file, "latin1") });
  await page.getByRole("button", { name: "Importar clientes" }).click();
  await waitUntilDone(page);
  await expect(page.getByTestId("import-success")).toContainText("Se crearon 1 cliente");
  const org = await prisma.organization.findUniqueOrThrow({ where: { slug } });
  expect(org.name).toBe("Pañalería José");
});

test("un archivo que no sirve se rechaza entero con un mensaje claro y no crea nada", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await openImport(page);
  const before = await prisma.agencyImport.count({ where: { agencyOrganizationId: fixture.organizationId } });
  await page.getByLabel("Archivo CSV").setInputFiles({ name: "malo.csv", mimeType: "text/csv", buffer: Buffer.from("telefono;direccion\n1;2", "utf8") });
  await page.getByRole("button", { name: "Importar clientes" }).click();
  await expect(page.getByTestId("import-upload-error")).toContainText("Faltan columnas en el encabezado");
  await expect(page.getByTestId("import-upload-error")).toContainText("identificador");
  await expectNoHorizontalScroll(page);
  await capture(page, `15-importar-archivo-invalido-${project}.png`);
  expect(await prisma.agencyImport.count({ where: { agencyOrganizationId: fixture.organizationId } })).toBe(before);
});
