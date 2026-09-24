import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./index.js";
import { contactRetentionCutoff, flagContactsForRetentionReview } from "./retention.js";

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
