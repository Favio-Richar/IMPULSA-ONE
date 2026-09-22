import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma } from "./index.js";

// F3.1 — invariantes del modelo de datos de conversión verificados contra el Postgres real, no
// contra el schema.prisma: lo que la *base de datos* garantiza aunque la capa de aplicación tenga
// un bug (mismo criterio que schema-sites.test.ts en F2.1). Las reglas de negocio que viven en la
// aplicación (antispam, matching de contacto, purga por retención) se prueban donde se implementan
// (F3.2, F3.3, F3.6).

const TEST_PREFIX = "f31-schema-test";

async function cleanup(): Promise<void> {
  // Las organizaciones borran en cascada sites -> forms -> fields/submissions, y
  // contacts/short_links/qr_codes/analytics_* directamente.
  await prisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

describe("Esquema de conversión: formularios, contactos, QR/enlaces y analítica (F3.1)", () => {
  let organizationId: string;
  let otherOrganizationId: string;
  let siteId: string;

  beforeAll(async () => {
    await cleanup();

    const [org, other] = await Promise.all([
      prisma.organization.create({ data: { name: "Org F3.1", slug: `${TEST_PREFIX}-a` } }),
      prisma.organization.create({ data: { name: "Org F3.1 B", slug: `${TEST_PREFIX}-b` } }),
    ]);
    organizationId = org.id;
    otherOrganizationId = other.id;

    const site = await prisma.site.create({
      data: { organizationId, name: "Sitio F3.1", slug: `${TEST_PREFIX}-sitio` },
    });
    siteId = site.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("el slug de enlace corto es único de forma global, incluso entre organizaciones distintas", async () => {
    const slug = `${TEST_PREFIX}-link-unico`;
    await prisma.shortLink.create({
      data: { organizationId, slug, destinationUrl: "https://ejemplo.cl/a" },
    });

    await expect(
      prisma.shortLink.create({
        data: { organizationId: otherOrganizationId, slug, destinationUrl: "https://ejemplo.cl/b" },
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("el email de contacto es único por organización, pero se repite entre organizaciones y admite null duplicado", async () => {
    const email = `${TEST_PREFIX}-dup@ejemplo.cl`;
    await prisma.contact.create({ data: { organizationId, email } });

    // Mismo email, misma organización: rechazado por el índice único parcial.
    await expect(prisma.contact.create({ data: { organizationId, email } })).rejects.toSatisfy(
      isUniqueViolation,
    );

    // Mismo email, otra organización: permitido (no es una identidad global, a diferencia de Site.slug).
    await expect(
      prisma.contact.create({ data: { organizationId: otherOrganizationId, email } }),
    ).resolves.toBeTruthy();

    // Dos contactos sin email en la misma organización: el WHERE del índice los deja convivir.
    await prisma.contact.create({ data: { organizationId, name: "Sin email 1" } });
    await expect(
      prisma.contact.create({ data: { organizationId, name: "Sin email 2" } }),
    ).resolves.toBeTruthy();
  });

  it("un QrCode necesita un ShortLink o una URL directa (CHECK de servidor)", async () => {
    await expect(
      prisma.qrCode.create({ data: { organizationId, styleConfig: {} } }),
    ).rejects.toThrow();

    await expect(
      prisma.qrCode.create({
        data: { organizationId, directUrl: "https://ejemplo.cl/directo", styleConfig: {} },
      }),
    ).resolves.toBeTruthy();

    const link = await prisma.shortLink.create({
      data: { organizationId, slug: `${TEST_PREFIX}-qr-link`, destinationUrl: "https://ejemplo.cl/c" },
    });
    await expect(
      prisma.qrCode.create({ data: { organizationId, shortLinkId: link.id, styleConfig: {} } }),
    ).resolves.toBeTruthy();
  });

  it("no se puede borrar un ShortLink mientras tenga un QrCode propio (Restrict, no huérfano silencioso)", async () => {
    const link = await prisma.shortLink.create({
      data: { organizationId, slug: `${TEST_PREFIX}-qr-restrict`, destinationUrl: "https://ejemplo.cl/d" },
    });
    await prisma.qrCode.create({ data: { organizationId, shortLinkId: link.id, styleConfig: {} } });

    // SetNull dejaría un QrCode con shortLinkId null y directUrl null, violando el CHECK de
    // arriba — por eso la relación es Restrict: borrar el enlace exige antes borrar/reasignar el QR.
    await expect(prisma.shortLink.delete({ where: { id: link.id } })).rejects.toThrow();
  });

  it("borrar un contacto arrastra sus eventos y envíos de formulario (derecho de cancelación, ADR-004)", async () => {
    const form = await prisma.form.create({
      data: { siteId, name: "Contacto", successAction: { message: "Gracias" } },
    });
    const contact = await prisma.contact.create({
      data: { organizationId, email: `${TEST_PREFIX}-cascada@ejemplo.cl` },
    });
    const submission = await prisma.formSubmission.create({
      data: { formId: form.id, contactId: contact.id, payload: { mensaje: "hola" } },
    });
    const event = await prisma.contactEvent.create({
      data: { contactId: contact.id, type: "FORM_SUBMISSION", payload: {} },
    });

    await prisma.contact.delete({ where: { id: contact.id } });

    expect(await prisma.formSubmission.count({ where: { id: submission.id } })).toBe(0);
    expect(await prisma.contactEvent.count({ where: { id: event.id } })).toBe(0);
  });

  it("borrar un formulario arrastra sus campos y envíos", async () => {
    const form = await prisma.form.create({
      data: { siteId, name: "Encuesta", successAction: { message: "Listo" } },
    });
    const field = await prisma.formField.create({
      data: { formId: form.id, type: "TEXT", label: "Nombre", position: 0 },
    });
    const submission = await prisma.formSubmission.create({
      data: { formId: form.id, payload: { nombre: "Ana" } },
    });

    await prisma.form.delete({ where: { id: form.id } });

    expect(await prisma.formField.count({ where: { id: field.id } })).toBe(0);
    expect(await prisma.formSubmission.count({ where: { id: submission.id } })).toBe(0);
  });

  it("un agregado analítico es único por organización, sitio, período y métrica", async () => {
    const data = {
      organizationId,
      siteId,
      period: "2026-09-22",
      metric: "page_view",
      value: 3,
    };
    await prisma.analyticsAggregate.create({ data });

    await expect(prisma.analyticsAggregate.create({ data })).rejects.toSatisfy(isUniqueViolation);
  });

  it("la clave de idempotencia de un evento analítico es única, pero varios eventos sin clave conviven", async () => {
    const key = `${TEST_PREFIX}-idem-1`;
    await prisma.analyticsEvent.create({
      data: { organizationId, siteId, type: "page_view", idempotencyKey: key },
    });

    await expect(
      prisma.analyticsEvent.create({
        data: { organizationId, siteId, type: "page_view", idempotencyKey: key },
      }),
    ).rejects.toSatisfy(isUniqueViolation);

    await prisma.analyticsEvent.create({ data: { organizationId, siteId, type: "block_click" } });
    await expect(
      prisma.analyticsEvent.create({ data: { organizationId, siteId, type: "block_click" } }),
    ).resolves.toBeTruthy();
  });

  it("borrar una organización arrastra contactos, enlaces cortos, QR y analítica (sin huérfanos)", async () => {
    const org = await prisma.organization.create({
      data: { name: "Cascada F3.1", slug: `${TEST_PREFIX}-cascada` },
    });
    const site = await prisma.site.create({
      data: { organizationId: org.id, name: "Cascada", slug: `${TEST_PREFIX}-cascada-sitio` },
    });
    const contact = await prisma.contact.create({ data: { organizationId: org.id } });
    const link = await prisma.shortLink.create({
      data: { organizationId: org.id, slug: `${TEST_PREFIX}-cascada-link`, destinationUrl: "https://ejemplo.cl" },
    });
    const qr = await prisma.qrCode.create({
      data: { organizationId: org.id, shortLinkId: link.id, styleConfig: {} },
    });
    const event = await prisma.analyticsEvent.create({
      data: { organizationId: org.id, siteId: site.id, type: "page_view" },
    });
    const aggregate = await prisma.analyticsAggregate.create({
      data: { organizationId: org.id, siteId: site.id, period: "2026-09-22", metric: "page_view", value: 1 },
    });
    const form = await prisma.form.create({
      data: { siteId: site.id, name: "Cascada", successAction: { message: "ok" } },
    });

    await prisma.organization.delete({ where: { id: org.id } });

    expect(await prisma.contact.count({ where: { id: contact.id } })).toBe(0);
    expect(await prisma.shortLink.count({ where: { id: link.id } })).toBe(0);
    expect(await prisma.qrCode.count({ where: { id: qr.id } })).toBe(0);
    expect(await prisma.analyticsEvent.count({ where: { id: event.id } })).toBe(0);
    expect(await prisma.analyticsAggregate.count({ where: { id: aggregate.id } })).toBe(0);
    expect(await prisma.form.count({ where: { id: form.id } })).toBe(0);
  });
});
