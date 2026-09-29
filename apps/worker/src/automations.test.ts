import "./load-dotenv.js";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import type { AutomationEventJob } from "@impulza/validation";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { processAutomationEvent } from "./automations.js";

// F6.7 — automatizaciones contra la base real: cada acción del catálogo, una vez por evento aunque
// el trabajo llegue dos veces, omisiones con motivo, reintento solo de lo que falló y nada que cruce
// organizaciones.

class RecordingEmail implements EmailAdapter {
  messages: EmailMessage[] = [];
  fail = false;
  async send(message: EmailMessage): Promise<void> {
    if (this.fail) throw new Error("proveedor caído");
    this.messages.push(message);
  }
}

describe("automatizaciones (F6.7)", () => {
  const prisma = new PrismaClient();
  const email = new RecordingEmail();
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let organizationId: string;
  let otherOrganizationId: string;
  let ownerEmail: string;

  function job(overrides: Partial<AutomationEventJob> = {}): AutomationEventJob {
    return { organizationId, trigger: "contact_created", subjectId: "00000000-0000-4000-8000-000000000000", contactId: null, occurredAt: new Date().toISOString(), ...overrides };
  }

  async function automation(trigger: string, action: object, extra: { enabled?: boolean; organizationId?: string } = {}) {
    return prisma.automation.create({ data: { organizationId: extra.organizationId ?? organizationId, name: `Auto ${trigger}`, trigger, action, enabled: extra.enabled ?? true } });
  }

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Barbería Auto", slug: `auto-${suffix}` } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Otra", slug: `auto-otra-${suffix}` } })).id;
    ownerEmail = `owner-${suffix}@automations.test`;
    const owner = await prisma.user.create({ data: { email: ownerEmail, passwordHash: "x", emailVerifiedAt: new Date() } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "OWNER" } });
    await prisma.membership.create({ data: { organizationId, userId: owner.id, roleId: role.id, status: "ACTIVE" } });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await prisma.user.deleteMany({ where: { email: ownerEmail } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    email.messages = [];
    email.fail = false;
    await prisma.automation.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
    await prisma.contact.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  });

  it("etiqueta y cambia el estado del contacto una sola vez aunque el evento llegue dos veces", async () => {
    const contact = await prisma.contact.create({ data: { organizationId, name: "Ana", email: `ana-${suffix}@example.com`, tags: ["web"] } });
    await automation("contact_created", { type: "tag_contact", tag: "nuevo-lead" });
    await automation("contact_created", { type: "set_commercial_status", status: "CONTACTED" });
    const event = job({ subjectId: contact.id, contactId: contact.id });

    expect(await processAutomationEvent(prisma, email, event)).toEqual({ succeeded: 2, skipped: 0, failed: 0 });
    expect(await processAutomationEvent(prisma, email, event)).toEqual({ succeeded: 0, skipped: 0, failed: 0 });

    const after = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(after.tags).toEqual(["web", "nuevo-lead"]);
    expect(after.commercialStatus).toBe("CONTACTED");
    const runs = await prisma.automationRun.findMany({ where: { organizationId } });
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "SUCCEEDED" && run.attempts === 1 && run.finishedAt !== null)).toBe(true);
  });

  it("avisa a los dueños con el detalle de la reserva, sin cruzar a otra organización ni correr las apagadas", async () => {
    const site = await prisma.site.create({ data: { organizationId, name: "Barbería", slug: `auto-site-${suffix}` } });
    const service = await prisma.bookableService.create({ data: { organizationId, siteId: site.id, name: "Corte", durationMinutes: 30 } });
    const contact = await prisma.contact.create({ data: { organizationId, name: "Luis", email: `luis-${suffix}@example.com` } });
    const startsAt = new Date("2031-06-02T14:00:00Z");
    const booking = await prisma.booking.create({
      data: { organizationId, siteId: site.id, serviceId: service.id, contactId: contact.id, serviceName: "Corte", durationMinutes: 30, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), timeZone: "America/Santiago", customerName: "Luis", customerEmail: contact.email! },
    });
    await automation("booking_created", { type: "notify_team" });
    await automation("booking_created", { type: "tag_contact", tag: "apagada" }, { enabled: false });
    await automation("booking_created", { type: "notify_team" }, { organizationId: otherOrganizationId });

    const result = await processAutomationEvent(prisma, email, job({ trigger: "booking_created", subjectId: booking.id, contactId: contact.id }), { dashboardBaseUrl: "https://panel.example.com/" });
    expect(result).toEqual({ succeeded: 1, skipped: 0, failed: 0 });
    expect(email.messages).toHaveLength(1);
    expect(email.messages[0]).toMatchObject({ to: ownerEmail });
    expect(email.messages[0]!.subject).toContain("Nueva reserva: Luis");
    expect(email.messages[0]!.text).toContain("Corte · ");
    expect(email.messages[0]!.text).toContain(`https://panel.example.com/contactos/${contact.id}`);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).tags).toEqual([]);
    expect(await prisma.automationRun.count({ where: { organizationId: otherOrganizationId } })).toBe(0);

    // Una reserva anotada sin contacto enlaza a la agenda real del panel (`/reservas`).
    email.messages = [];
    const manual = await prisma.booking.create({
      data: { organizationId, siteId: site.id, serviceId: service.id, serviceName: "Corte", durationMinutes: 30, startsAt: new Date("2031-06-03T14:00:00Z"), endsAt: new Date("2031-06-03T14:30:00Z"), timeZone: "America/Santiago", customerName: "Sin ficha", customerEmail: `sinficha-${suffix}@example.com`, source: "MANUAL" },
    });
    await processAutomationEvent(prisma, email, job({ trigger: "booking_created", subjectId: manual.id, contactId: null }), { dashboardBaseUrl: "https://panel.example.com" });
    expect(email.messages[0]!.text).toContain("https://panel.example.com/reservas");
    expect(email.messages[0]!.subject).toBe("Nueva reserva · Barbería Auto");
  });

  it("sin contacto, o con un contacto de otra organización, la acción se omite con motivo", async () => {
    const foreign = await prisma.contact.create({ data: { organizationId: otherOrganizationId, name: "Ajeno" } });
    await automation("order_created", { type: "tag_contact", tag: "comprador" });
    await processAutomationEvent(prisma, email, job({ trigger: "order_created", subjectId: foreign.id, contactId: foreign.id }));
    const run = await prisma.automationRun.findFirstOrThrow({ where: { organizationId } });
    expect(run).toMatchObject({ status: "SKIPPED" });
    expect(run.detail).toContain("contacto");
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: foreign.id } })).tags).toEqual([]);
  });

  it("si el correo falla, queda FAILED con motivo y el reintento solo repite lo fallido", async () => {
    const contact = await prisma.contact.create({ data: { organizationId, name: "Eva" } });
    await automation("contact_created", { type: "tag_contact", tag: "eva" });
    await automation("contact_created", { type: "notify_team" });
    const event = job({ subjectId: contact.id, contactId: contact.id });

    email.fail = true;
    await expect(processAutomationEvent(prisma, email, event)).rejects.toThrow("1 automatizaciones fallaron");
    const failed = await prisma.automationRun.findFirstOrThrow({ where: { organizationId, status: "FAILED" } });
    expect(failed.detail).toBe("El proveedor de correo no aceptó el aviso.");

    email.fail = false;
    expect(await processAutomationEvent(prisma, email, event)).toEqual({ succeeded: 1, skipped: 0, failed: 0 });
    expect(email.messages).toHaveLength(1);
    const runs = await prisma.automationRun.findMany({ where: { organizationId }, orderBy: { attempts: "asc" } });
    expect(runs.map((run) => [run.status, run.attempts])).toEqual([["SUCCEEDED", 1], ["SUCCEEDED", 2]]);
  });

  it("una configuración guardada que ya no es válida se omite, y una organización bloqueada no ejecuta nada", async () => {
    await automation("contact_created", { type: "webhook", url: "https://evil.example.com" });
    await processAutomationEvent(prisma, email, job({ subjectId: "11111111-1111-4111-8111-111111111111" }));
    expect((await prisma.automationRun.findFirstOrThrow({ where: { organizationId } })).status).toBe("SKIPPED");

    await prisma.organization.update({ where: { id: otherOrganizationId }, data: { status: "BLOCKED" } });
    await automation("contact_created", { type: "notify_team" }, { organizationId: otherOrganizationId });
    expect(await processAutomationEvent(prisma, email, job({ organizationId: otherOrganizationId }))).toEqual({ succeeded: 0, skipped: 0, failed: 0 });
    await prisma.organization.update({ where: { id: otherOrganizationId }, data: { status: "ACTIVE" } });
  });
});
