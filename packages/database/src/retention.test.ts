import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AbuseReportReason, AbuseReportStatus, prisma } from "./index.js";
import { abuseReportEmailRetentionCutoff, contactRetentionCutoff, flagContactsForRetentionReview, purgeExpiredAbuseReportReporterEmails } from "./retention.js";

// ADR-004 punto 4 — revisión de retención de contactos, contra Postgres real.

const TEST_PREFIX = "retention-review-test";
const NOW = new Date("2030-01-15T12:00:00.000Z");
const MONTHS = 36;
const OLD = new Date("2026-06-01T12:00:00.000Z"); // más de 36 meses antes de NOW
const RECENT = new Date("2029-12-01T12:00:00.000Z");

async function cleanup(): Promise<void> {
  await prisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
}

/** Contacto con fechas controladas: `updated_at` se escribe con SQL porque `@updatedAt` de Prisma
 *  lo pisaría con la hora actual. */
async function contactWithDates(organizationId: string, name: string, dates: { created: Date; updated: Date }) {
  const contact = await prisma.contact.create({ data: { organizationId, name } });
  await prisma.$executeRaw`UPDATE contacts SET created_at = ${dates.created}, updated_at = ${dates.updated} WHERE id = ${contact.id}::uuid`;
  return contact.id;
}

describe("Revisión de retención de contactos (ADR-004 punto 4)", () => {
  let organizationId: string;

  beforeAll(async () => {
    await cleanup();
    const org = await prisma.organization.create({ data: { name: "Org retención", slug: `${TEST_PREFIX}-a` } });
    organizationId = org.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("el corte de 36 meses cae en la fecha esperada", () => {
    expect(contactRetentionCutoff(NOW, 36).toISOString()).toBe("2027-01-15T12:00:00.000Z");
  });

  it("marca solo al inactivo; un evento reciente cuenta como interacción; nunca borra", async () => {
    const inactive = await contactWithDates(organizationId, "Inactivo", { created: OLD, updated: OLD });
    const edited = await contactWithDates(organizationId, "Editado hace poco", { created: OLD, updated: RECENT });
    const withRecentEvent = await contactWithDates(organizationId, "Con envío reciente", { created: OLD, updated: OLD });
    await prisma.contactEvent.create({ data: { contactId: withRecentEvent, type: "NOTE", createdAt: RECENT } });

    await flagContactsForRetentionReview(prisma, { months: MONTHS, now: NOW, organizationId });

    const byId = new Map(
      (await prisma.contact.findMany({ where: { organizationId } })).map((c) => [c.id, c]),
    );
    expect(byId.get(inactive)?.retentionReviewAt?.toISOString()).toBe(NOW.toISOString());
    expect(byId.get(edited)?.retentionReviewAt).toBeNull();
    expect(byId.get(withRecentEvent)?.retentionReviewAt).toBeNull();
    // Nada se borró: la decisión es del dueño.
    expect(byId.size).toBe(3);
    // Marcar no cuenta como interacción: `updated_at` del inactivo sigue siendo el viejo.
    expect(byId.get(inactive)?.updatedAt.toISOString()).toBe(OLD.toISOString());
  });

  it("correr el job de nuevo no vuelve a marcar, y desmarca al que volvió a tener actividad", async () => {
    const contactId = await contactWithDates(organizationId, "Vuelve", { created: OLD, updated: OLD });
    await flagContactsForRetentionReview(prisma, { months: MONTHS, now: NOW, organizationId });
    const firstMark = (await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).retentionReviewAt;

    const later = new Date("2030-01-16T12:00:00.000Z");
    const again = await flagContactsForRetentionReview(prisma, { months: MONTHS, now: later, organizationId });
    expect(again.flagged).toBe(0);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).retentionReviewAt).toEqual(firstMark);

    await prisma.contactEvent.create({ data: { contactId, type: "FORM_SUBMISSION", createdAt: later } });
    const result = await flagContactsForRetentionReview(prisma, { months: MONTHS, now: later, organizationId });
    expect(result.cleared).toBeGreaterThanOrEqual(1);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).retentionReviewAt).toBeNull();
  });
});

describe("Retención del correo del denunciante en reportes de abuso (F9.9, decisión del propietario 2026-10-13)", () => {
  const ABUSE_PREFIX = "retention-abuse-test";
  const ABUSE_NOW = new Date("2030-01-15T12:00:00.000Z");
  const DAYS = 90;
  // Más de 90 días antes de ABUSE_NOW.
  const CLOSED_LONG_AGO = new Date("2029-09-01T00:00:00.000Z");
  // Menos de 90 días antes de ABUSE_NOW: aún dentro de la ventana.
  const CLOSED_RECENTLY = new Date("2030-01-01T00:00:00.000Z");

  let organizationId: string;
  let siteId: string;

  async function abuseCleanup(): Promise<void> {
    await prisma.organization.deleteMany({ where: { slug: { startsWith: ABUSE_PREFIX } } });
  }

  beforeAll(async () => {
    await abuseCleanup();
    const org = await prisma.organization.create({ data: { name: "Org denuncias", slug: `${ABUSE_PREFIX}-a` } });
    organizationId = org.id;
    const site = await prisma.site.create({ data: { organizationId, name: "Sitio denunciado", slug: `${ABUSE_PREFIX}-site` } });
    siteId = site.id;
  });

  afterAll(async () => {
    await abuseCleanup();
  });

  async function reportClosedAt(status: AbuseReportStatus, resolvedAt: Date | null, reporterEmail: string | null) {
    const report = await prisma.abuseReport.create({
      data: { organizationId, siteId, reason: AbuseReportReason.SPAM, reporterEmail, status: AbuseReportStatus.OPEN },
    });
    if (resolvedAt) {
      await prisma.abuseReport.update({ where: { id: report.id }, data: { status, resolvedAt } });
    }
    return report.id;
  }

  it("el corte de 90 días cae en la fecha esperada", () => {
    expect(abuseReportEmailRetentionCutoff(ABUSE_NOW, DAYS).toISOString()).toBe("2029-10-17T12:00:00.000Z");
  });

  it("borra el correo de un caso cerrado hace más de 90 días; conserva el de uno cerrado hace poco, uno sin correo, uno abierto y uno apelado", async () => {
    const closedLongAgo = await reportClosedAt(AbuseReportStatus.DISMISSED, CLOSED_LONG_AGO, "persona@correo.com");
    const closedRecently = await reportClosedAt(AbuseReportStatus.WARNED, CLOSED_RECENTLY, "otra@correo.com");
    const withoutEmail = await reportClosedAt(AbuseReportStatus.SITE_UNPUBLISHED, CLOSED_LONG_AGO, null);
    const stillOpen = await prisma.abuseReport.create({
      data: { organizationId, siteId, reason: AbuseReportReason.FRAUD, reporterEmail: "abierto@correo.com", status: AbuseReportStatus.OPEN },
    });
    // Apelado: guarda el resolvedAt de la decisión original (ya vieja) pero el caso no está cerrado.
    const appealed = await prisma.abuseReport.create({
      data: { organizationId, siteId, reason: AbuseReportReason.OTHER, reporterEmail: "apelado@correo.com", status: AbuseReportStatus.APPEALED, resolvedAt: CLOSED_LONG_AGO, statusBeforeAppeal: AbuseReportStatus.WARNED },
    });

    const result = await purgeExpiredAbuseReportReporterEmails(prisma, { days: DAYS, now: ABUSE_NOW });
    expect(result.purged).toBe(1);

    const byId = new Map((await prisma.abuseReport.findMany({ where: { organizationId } })).map((r) => [r.id, r]));
    expect(byId.get(closedLongAgo)?.reporterEmail).toBeNull();
    expect(byId.get(closedRecently)?.reporterEmail).toBe("otra@correo.com");
    expect(byId.get(withoutEmail)?.reporterEmail).toBeNull();
    expect(byId.get(stillOpen.id)?.reporterEmail).toBe("abierto@correo.com");
    expect(byId.get(appealed.id)?.reporterEmail).toBe("apelado@correo.com");
    // Nada se borró: solo el correo, nunca el reporte ni su decisión.
    expect(byId.size).toBe(5);
    expect(byId.get(closedLongAgo)?.status).toBe(AbuseReportStatus.DISMISSED);
  });

  it("correr el job de nuevo no vuelve a tocar nada (ya no hay correos que vencer)", async () => {
    const again = await purgeExpiredAbuseReportReporterEmails(prisma, { days: DAYS, now: ABUSE_NOW });
    expect(again.purged).toBe(0);
  });
});
