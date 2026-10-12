import { readFileSync } from "node:fs";
import { PrismaClient } from "@impulza/database";
import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";
import { FIXTURE_PATH, type SeededFixture } from "../global-setup.js";
import { PUBLIC_WEB_URL } from "../playwright.config.js";

// F10.7 — barrido de accesibilidad (WCAG 2.2 AA) de todas las superficies nuevas de la Fase 10, en teléfono y escritorio:
// panel (miembros, cursos, tarjeta, marketplace) y público (tarjeta, cursos, directorio de socios, aviso sin conexión).
// Usa axe-core con las reglas A y AA. Una violación falla la prueba con el nombre de la regla y el elemento.

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SeededFixture;
const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
const COURSE_SLUG = `a11y-${suffix}`;

test.beforeAll(async () => {
  await prisma.digitalCard.upsert({
    where: { siteId: fixture.siteId },
    create: {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      enabled: true,
      fullName: "Ana María Pérez",
      jobTitle: "Fotógrafa",
      company: "Estudio Luz",
      bio: "Fotografía de retrato y moda.",
      phone: "+56912345678",
      email: "ana@estudioluz.cl",
      website: "https://estudioluz.cl",
      socials: [{ network: "instagram", url: "https://instagram.com/estudioluz" }],
    },
    update: { enabled: true },
  });
  const course = await prisma.course.create({
    data: {
      organizationId: fixture.organizationId,
      siteId: fixture.siteId,
      slug: COURSE_SLUG,
      title: `Curso de accesibilidad ${suffix}`,
      summary: "Un curso abierto para el barrido.",
      status: "PUBLISHED",
      access: "OPEN",
    },
  });
  const module = await prisma.courseModule.create({ data: { organizationId: fixture.organizationId, courseId: course.id, title: "Primeros pasos" } });
  await prisma.lesson.create({
    data: {
      organizationId: fixture.organizationId,
      courseId: course.id,
      moduleId: module.id,
      title: "Bienvenida",
      kind: "TEXT",
      body: "<p>Hola, esta es la primera lección.</p>",
      durationMinutes: 3,
    },
  });
});

test.afterAll(async () => {
  // La organización sembrada la comparten todas las pruebas: se deja como estaba.
  await prisma.course.deleteMany({ where: { siteId: fixture.siteId, slug: COURSE_SLUG } });
  await prisma.digitalCard.deleteMany({ where: { siteId: fixture.siteId } });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixture.organizationId, targetType: { in: ["DigitalCard", "Course"] } } });
  await prisma.$disconnect();
});

async function audit(page: Page, label: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return result.violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    }));
  });
  expect(violations, `${label}: ${JSON.stringify(violations, null, 1)}`).toEqual([]);
}

test.describe("Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      window.localStorage.setItem("impulza-active-org", JSON.stringify({ state: { activeOrganizationId: id }, version: 0 }));
    }, fixture.organizationId);
  });

  for (const [name, path, heading] of [
    ["miembros", `/sitios/${fixture.siteId}/miembros`, /Miembros/],
    ["cursos", `/sitios/${fixture.siteId}/cursos`, /Cursos/],
    ["tarjeta digital", `/sitios/${fixture.siteId}/tarjeta`, /Tarjeta digital/],
    ["marketplace", "/marketplace", /Marketplace|Integraciones/],
  ] as const) {
    test(`panel · ${name}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await audit(page, `panel ${name}`);
    });
  }
});

test.describe("Público", () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: PUBLIC_WEB_URL });

  for (const [name, path, heading] of [
    ["tarjeta digital", `/${fixture.siteSlug}/t`, /Ana María Pérez/],
    ["lista de cursos", `/${fixture.siteSlug}/c`, /^Cursos$/],
    ["curso", `/${fixture.siteSlug}/c/${COURSE_SLUG}`, /Curso de accesibilidad/],
    ["directorio de integraciones y socios", "/integraciones", /Conecta tu portal/],
    ["planes (pie compartido)", "/planes", /plan/i],
    ["plantillas", "/plantillas", /plantilla/i],
    ["aviso sin conexión", "/offline.html", /Sin conexión|conexión/i],
  ] as const) {
    test(`público · ${name}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await audit(page, `público ${name}`);
    });
  }
});
