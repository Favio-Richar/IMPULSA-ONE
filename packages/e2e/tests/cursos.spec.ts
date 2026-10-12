import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// F10.3 (ADR-029) — cursos, en teléfono y escritorio: el negocio arma un curso desde el panel (módulo, lección de muestra y lección
// cerrada) y lo publica; un visitante ve el temario y la lección de muestra pero NO el contenido cerrado; un miembro entra con su
// enlace, lee la lección, la marca como completada y su avance queda guardado.

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const CAPTURES = "../../docs/design/capturas/f103";
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const SECRET = "CONTENIDO-CERRADO-DEL-CURSO-E2E";
const createdMemberEmails: string[] = [];
const createdCourseTitles: string[] = [];

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba.
  const courses = await prisma.course.findMany({ where: { siteId: fixture.siteId, title: { in: createdCourseTitles } }, select: { id: true } });
  await prisma.course.deleteMany({ where: { id: { in: courses.map((course) => course.id) } } });
  await prisma.siteMember.deleteMany({ where: { siteId: fixture.siteId, email: { in: createdMemberEmails } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, OR: [{ targetType: "Course" }, { targetType: "SiteMember" }] } });
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

/** Equivale a lo que hace la API al enviar el correo: un token de un solo uso del que solo se guarda el hash. */
async function issueLoginToken(memberEmail: string): Promise<string> {
  const member = await prisma.siteMember.findUniqueOrThrow({ where: { siteId_email: { siteId: fixture.siteId, email: memberEmail } } });
  const token = randomBytes(32).toString("base64url");
  await prisma.siteMemberLoginToken.create({
    data: { memberId: member.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  return token;
}

test("armar, publicar, ver el temario, entrar como miembro y avanzar", async ({ browser, page }, testInfo) => {
  const project = testInfo.project.name;
  const use = testInfo.project.use as BrowserContextOptions;
  const title = `Curso E2E ${project} ${suffix}`;
  const memberEmail = `alumno-${project}-${suffix}@e2e.test`;
  createdCourseTitles.push(title);
  createdMemberEmails.push(memberEmail);

  // --- Panel: crear el curso por la interfaz ---
  await page.addInitScript((id) => {
    window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
  }, fixture.organizationId);
  await page.goto(`/sitios/${fixture.siteId}/cursos`);
  await expect(page.getByRole("heading", { name: "Cursos", exact: true })).toBeVisible();

  const create = page.getByRole("form", { name: "Crear curso" });
  await create.getByRole("button", { name: "Crear curso" }).click();
  await expect(create.getByText("Ponle un nombre al curso.")).toBeVisible();
  await create.getByLabel("Nombre del curso").fill(title);
  await create.getByRole("button", { name: "Crear curso" }).click();
  await expect(page.getByRole("heading", { name: "Editar curso" })).toBeVisible();

  // Publicar sin lecciones se rechaza con un mensaje claro.
  await page.getByRole("button", { name: "Publicar curso" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "al menos una lección" })).toBeVisible();

  // Un módulo y dos lecciones: una de muestra y una cerrada.
  const addModule = page.getByRole("form", { name: "Agregar módulo" });
  await addModule.getByLabel("Nuevo módulo").fill("Primeros pasos");
  await addModule.getByRole("button", { name: "Agregar módulo" }).click();
  await expect(page.getByLabel("Módulo 1")).toHaveValue("Primeros pasos");

  await page.getByRole("button", { name: "Agregar lección" }).click();
  let lesson = page.getByRole("form", { name: "Nueva lección" });
  await lesson.getByLabel("Título de la lección").fill("Bienvenida");
  await lesson.getByRole("textbox", { name: "Contenido de la lección" }).fill("Hola, esta es la lección de muestra.");
  await lesson.getByLabel("Lección de muestra: la puede ver cualquiera").check();
  await lesson.getByRole("button", { name: "Agregar lección" }).click();
  await expect(page.getByText("Bienvenida")).toBeVisible();
  await expect(page.getByText("De muestra", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Agregar lección" }).click();
  lesson = page.getByRole("form", { name: "Nueva lección" });
  await lesson.getByRole("button", { name: "Agregar lección" }).click();
  await expect(lesson.getByRole("alert").filter({ hasText: "Ponle un título" })).toBeVisible();
  await lesson.getByLabel("Título de la lección").fill("Tu primer ejercicio");
  await lesson.getByRole("textbox", { name: "Contenido de la lección" }).fill(SECRET);
  await lesson.getByRole("button", { name: "Agregar lección" }).click();
  await expect(page.getByText("Tu primer ejercicio")).toBeVisible();

  await page.getByRole("button", { name: "Publicar curso" }).click();
  await expect(page.getByRole("button", { name: "Ocultar curso" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await capture(page, `01-editor-${project}.png`);

  // --- Visitante sin acceso: temario y lección de muestra sí; el contenido cerrado, NO ---
  const visitor = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
  const web = await visitor.newPage();
  await web.goto(`/${fixture.siteSlug}/c`);
  await expect(web.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await expectNoHorizontalScroll(web);
  await capture(web, `02-listado-${project}.png`);

  await web.getByRole("link", { name: new RegExp(title) }).click();
  await expect(web.getByRole("heading", { name: title })).toBeVisible();
  await expect(web.getByText("Este curso es para miembros")).toBeVisible();
  expect(await web.content()).not.toContain(SECRET);
  await expectNoHorizontalScroll(web);
  await capture(web, `03-temario-${project}.png`);

  await web.getByRole("link", { name: /Bienvenida/ }).click();
  await expect(web.getByRole("heading", { name: "Bienvenida" })).toBeVisible();
  await expect(web.getByText("Hola, esta es la lección de muestra.")).toBeVisible();

  await web.goto(`/${fixture.siteSlug}/c`);
  await web.getByRole("link", { name: new RegExp(title) }).click();
  await web.getByRole("link", { name: /Tu primer ejercicio/ }).click();
  await expect(web.getByRole("heading", { name: "Contenido para miembros" })).toBeVisible();
  expect(await web.content()).not.toContain(SECRET);
  await capture(web, `04-bloqueada-${project}.png`);

  // --- Miembro: entra con su enlace, lee, completa y su avance queda ---
  await prisma.siteMember.create({ data: { organizationId: fixture.organizationId, siteId: fixture.siteId, email: memberEmail, name: "Alumno E2E", source: "INVITED" } });
  const token = await issueLoginToken(memberEmail);
  await web.goto(`/miembros/${token}`);
  await web.getByRole("button", { name: "Entrar" }).click();
  await expect(web).toHaveURL(new RegExp(`/${fixture.siteSlug}$`));

  await web.goto(`/${fixture.siteSlug}/c`);
  await web.getByRole("link", { name: new RegExp(title) }).click();
  await expect(web.getByRole("progressbar", { name: "Tu avance" })).toHaveAttribute("aria-valuenow", "0");
  await web.getByRole("link", { name: /Tu primer ejercicio/ }).click();
  await expect(web.getByText(SECRET)).toBeVisible();
  await expectNoHorizontalScroll(web);
  await capture(web, `05-leccion-${project}.png`);

  await web.getByRole("button", { name: "Marcar como completada y seguir" }).click();
  // Era la última lección: vuelve al temario con el avance guardado.
  await expect(web.getByRole("progressbar", { name: "Tu avance" })).toHaveAttribute("aria-valuenow", "50");
  await expect(web.getByText("1 de 2 completadas (50%)")).toBeVisible();
  await web.reload();
  await expect(web.getByRole("progressbar", { name: "Tu avance" })).toHaveAttribute("aria-valuenow", "50");
  await capture(web, `06-avance-${project}.png`);

  // Desmarcar devuelve el avance.
  await web.getByRole("link", { name: /Tu primer ejercicio/ }).click();
  await web.getByRole("button", { name: "Marcar como pendiente" }).click();
  await expect(web.getByRole("button", { name: "Marcar como completada y seguir" })).toBeVisible();

  // --- El panel ve a la persona que avanzó ---
  await page.reload();
  await expect(page.getByText(/persona(s)? ha(n)? avanzado/)).toBeVisible();

  await visitor.close();
});

test("un curso o una lección inventados responden 404, sin pistas", async ({ browser }, testInfo) => {
  const use = testInfo.project.use as BrowserContextOptions;
  const context = await browser.newContext({ ...use, storageState: undefined, baseURL: PUBLIC_WEB_URL });
  const web = await context.newPage();
  const course = await web.goto(`/${fixture.siteSlug}/c/no-existe-este-curso`);
  expect(course?.status()).toBe(404);
  const lesson = await web.goto(`/${fixture.siteSlug}/c/no-existe-este-curso/00000000-0000-4000-8000-000000000000`);
  expect(lesson?.status()).toBe(404);
  await context.close();
});
