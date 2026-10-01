import "./load-dotenv.js";
import { randomUUID } from "node:crypto";
import { verifySequenceUnsubscribeToken, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import type { AutomationEventJob } from "@impulza/validation";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dispatchSequences, enrollInSequences } from "./sequences.js";

// F7.5 (ADR-020): inscripción y envío de secuencias contra la base real, con el reloj fijo y dentro
// de una organización propia (las demás suites corren a la vez).

const HOUR = 3_600_000;
const SECRET = "s".repeat(40);
const BASE = "https://impulza.test";

class RecordingEmail implements EmailAdapter {
  messages: EmailMessage[] = [];
  failNext = false;
  async send(message: EmailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("SMTP caído");
    }
    this.messages.push(message);
  }
}

describe("secuencias de correo en el worker (F7.5)", () => {
  const prisma = new PrismaClient();
  const email = new RecordingEmail();
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const t0 = new Date("2031-05-01T12:00:00Z");
  let organizationId: string;

  const options = (now: Date) => ({ publicSiteBaseUrl: BASE, linkSecret: SECRET, now, organizationId });
  const job = (contactId: string, trigger: AutomationEventJob["trigger"] = "newsletter_subscribed"): AutomationEventJob => ({
    organizationId,
    trigger,
    subjectId: randomUUID(),
    contactId,
    occurredAt: t0.toISOString(),
  });

  async function contact(label: string, extra: Record<string, unknown> = {}) {
    return prisma.contact.create({
      data: { organizationId, name: `${label} Pérez`, email: `${label}-${suffix}@sequences-worker.test`, marketingConsentAt: t0, marketingConsentSource: "test", ...extra },
    });
  }

  async function sequence(steps: Array<[number, string]>, extra: Record<string, unknown> = {}) {
    return prisma.emailSequence.create({
      data: {
        organizationId,
        name: `Secuencia ${Math.random().toString(36).slice(2, 6)}`,
        trigger: "newsletter_subscribed",
        emailsPerHour: 100,
        ...extra,
        steps: { create: steps.map(([delayHours, subject], position) => ({ position, delayHours, subject, bodyHtml: `<p>Hola {{nombre}}, ${subject}.</p>` })) },
      },
    });
  }

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Café Secuencias", slug: `seq-${suffix}` } })).id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    email.messages.length = 0;
    await prisma.emailSequence.deleteMany({ where: { organizationId } });
  });

  it("inscribe una sola vez, solo con consentimiento de marketing, y solo en secuencias encendidas de ese disparador", async () => {
    const welcome = await sequence([[0, "bienvenida"]]);
    await sequence([[0, "apagada"]], { enabled: false });
    await sequence([[0, "otro disparador"]], { trigger: "order_created" });
    const ana = await contact("ana");
    const sinPermiso = await contact("sin", { marketingConsentAt: null });
    const deBaja = await contact("baja", { marketingUnsubscribedAt: t0 });

    expect(await enrollInSequences(prisma, job(ana.id))).toBe(1);
    expect(await enrollInSequences(prisma, job(ana.id))).toBe(0);
    expect(await enrollInSequences(prisma, job(sinPermiso.id))).toBe(0);
    expect(await enrollInSequences(prisma, job(deBaja.id))).toBe(0);
    expect(await enrollInSequences(prisma, { ...job(ana.id), contactId: null })).toBe(0);
    const enrollments = await prisma.emailSequenceEnrollment.findMany({ where: { organizationId } });
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0]).toMatchObject({ sequenceId: welcome.id, contactId: ana.id, status: "ACTIVE", nextStep: 0, nextSendAt: t0 });
  });

  it("envía cada paso a su hora, personalizado y con su baja; al final la cierra", async () => {
    await sequence([[0, "bienvenida"], [24, "consejos"], [48, "oferta"]]);
    const ana = await contact("ana2");
    await enrollInSequences(prisma, job(ana.id));

    expect((await dispatchSequences(prisma, email, options(t0))).sent).toBe(1);
    const first = email.messages[0]!;
    expect(first).toMatchObject({ to: ana.email, subject: "bienvenida" });
    expect(first.html).toContain("Hola ana2, bienvenida.");
    const token = /\/baja\/([^"<\s]+)/.exec(first.html ?? "")?.[1];
    const enrollment = await prisma.emailSequenceEnrollment.findFirstOrThrow({ where: { contactId: ana.id } });
    expect(verifySequenceUnsubscribeToken(token!, SECRET)).toBe(enrollment.id);
    expect(first.headers?.["List-Unsubscribe"]).toBe(`<${BASE}/api/unsubscribe/${token}>`);
    expect(enrollment).toMatchObject({ nextStep: 1, nextSendAt: new Date(t0.getTime() + 24 * HOUR) });

    // Antes de tiempo, nada.
    expect((await dispatchSequences(prisma, email, options(new Date(t0.getTime() + 23 * HOUR)))).sent).toBe(0);
    expect((await dispatchSequences(prisma, email, options(new Date(t0.getTime() + 24 * HOUR)))).sent).toBe(1);
    const third = await dispatchSequences(prisma, email, options(new Date(t0.getTime() + 72 * HOUR)));
    expect(third).toMatchObject({ sent: 1, completed: 1 });
    expect(email.messages.map((message) => message.subject)).toEqual(["bienvenida", "consejos", "oferta"]);
    expect(await prisma.emailSequenceEnrollment.findFirstOrThrow({ where: { contactId: ana.id } })).toMatchObject({ status: "COMPLETED", nextSendAt: null });
    expect(await prisma.emailSequenceSend.count({ where: { enrollment: { contactId: ana.id }, status: "SENT" } })).toBe(3);
  });

  it("si se dio de baja antes del paso, se detiene sin enviar; una secuencia apagada espera sin perder su turno", async () => {
    const seq = await sequence([[0, "uno"], [1, "dos"]]);
    const ana = await contact("ana3");
    const bea = await contact("bea3");
    await enrollInSequences(prisma, job(ana.id));
    await enrollInSequences(prisma, job(bea.id));
    await prisma.contact.update({ where: { id: ana.id }, data: { marketingUnsubscribedAt: t0 } });

    const result = await dispatchSequences(prisma, email, options(t0));
    expect(result).toMatchObject({ sent: 1, stopped: 1 });
    expect(email.messages.map((message) => message.to)).toEqual([bea.email]);
    expect(await prisma.emailSequenceEnrollment.findFirstOrThrow({ where: { contactId: ana.id } })).toMatchObject({ status: "STOPPED", stopReason: "unsubscribed" });

    await prisma.emailSequence.update({ where: { id: seq.id }, data: { enabled: false } });
    expect((await dispatchSequences(prisma, email, options(new Date(t0.getTime() + 2 * HOUR)))).sent).toBe(0);
    await prisma.emailSequence.update({ where: { id: seq.id }, data: { enabled: true } });
    expect((await dispatchSequences(prisma, email, options(new Date(t0.getTime() + 3 * HOUR)))).sent).toBe(1);
  });

  it("no se pasa del límite por hora (compartido con las campañas): lo que no cabe espera", async () => {
    await sequence([[0, "uno"]], { emailsPerHour: 2 });
    const people = await Promise.all(["c1", "c2", "c3"].map((label) => contact(label)));
    for (const person of people) await enrollInSequences(prisma, job(person.id));

    expect(await dispatchSequences(prisma, email, options(t0))).toMatchObject({ sent: 2, deferred: 1 });
    // Dentro de la misma hora, sigue sin cupo; una hora después, sale.
    expect((await dispatchSequences(prisma, email, options(new Date(t0.getTime() + 30 * 60_000)))).sent).toBe(0);
    expect((await dispatchSequences(prisma, email, options(new Date(t0.getTime() + HOUR + 60_000)))).sent).toBe(1);
  });

  it("dos pasadas a la vez no envían dos veces, y un envío ya registrado no se repite tras una caída", async () => {
    await sequence([[0, "uno"], [5, "dos"]]);
    const people = await Promise.all(["d1", "d2", "d3", "d4"].map((label) => contact(label)));
    for (const person of people) await enrollInSequences(prisma, job(person.id));

    await Promise.all([dispatchSequences(prisma, email, options(t0)), dispatchSequences(prisma, email, options(t0))]);
    expect(email.messages).toHaveLength(4);
    expect(new Set(email.messages.map((message) => message.to)).size).toBe(4);

    // Simula una caída después de enviar el paso 1: fila registrada, inscripción sin avanzar.
    const victim = await prisma.emailSequenceEnrollment.findFirstOrThrow({ where: { contactId: people[0]!.id } });
    await prisma.emailSequenceSend.create({ data: { organizationId, enrollmentId: victim.id, stepPosition: 1, status: "SENT", sentAt: t0 } });
    email.messages.length = 0;
    await dispatchSequences(prisma, email, options(new Date(t0.getTime() + 5 * HOUR)));
    expect(email.messages.map((message) => message.to).sort()).toEqual(people.slice(1).map((person) => person.email).sort());
    expect(await prisma.emailSequenceEnrollment.findUniqueOrThrow({ where: { id: victim.id } })).toMatchObject({ status: "COMPLETED" });
  });

  it("un paso borrado se salta; un error de envío queda registrado y la secuencia sigue", async () => {
    const seq = await sequence([[0, "uno"], [1, "dos"], [1, "tres"]]);
    const ana = await contact("ana6");
    await enrollInSequences(prisma, job(ana.id));
    email.failNext = true;
    await dispatchSequences(prisma, email, options(t0));
    expect(await prisma.emailSequenceSend.findFirstOrThrow({ where: { enrollment: { contactId: ana.id }, stepPosition: 0 } })).toMatchObject({ status: "FAILED", error: "SMTP caído" });

    await prisma.emailSequenceStep.deleteMany({ where: { sequenceId: seq.id, position: 1 } });
    await dispatchSequences(prisma, email, options(new Date(t0.getTime() + HOUR)));
    expect(email.messages.map((message) => message.subject)).toEqual(["tres"]);
    expect(await prisma.emailSequenceEnrollment.findFirstOrThrow({ where: { contactId: ana.id } })).toMatchObject({ status: "COMPLETED" });
  });
});
