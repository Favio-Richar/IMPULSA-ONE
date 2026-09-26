import "./load-dotenv.js";
import { verifyBookingLinkToken, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendDueBookingReminders } from "./booking-reminders.js";

// F5.4 — recordatorios de reserva contra la base real: cuáles tocan, uno solo por reserva, y un
// envío fallido que se libera para reintentar.

const HOUR = 3_600_000;
const SECRET = "r".repeat(32);

class RecordingEmail implements EmailAdapter {
  messages: EmailMessage[] = [];
  failFor = new Set<string>();
  async send(message: EmailMessage): Promise<void> {
    if (this.failFor.has(message.to)) throw new Error("proveedor caído");
    this.messages.push(message);
  }
}

describe("recordatorios de reserva (F5.4)", () => {
  const prisma = new PrismaClient();
  const email = new RecordingEmail();
  const now = new Date("2031-05-10T12:00:00Z");
  let organizationId: string;
  let siteId: string;
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  async function booking(label: string, startsInHours: number, createdHoursBeforeNow: number, extra: Record<string, unknown> = {}) {
    const startsAt = new Date(now.getTime() + startsInHours * HOUR);
    return prisma.booking.create({
      data: {
        organizationId,
        siteId,
        serviceName: "Sesión",
        durationMinutes: 30,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        timeZone: "America/Santiago",
        customerName: label,
        customerEmail: `${label}-${suffix}@reminders.test`,
        createdAt: new Date(now.getTime() - createdHoursBeforeNow * HOUR),
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Recordatorios", slug: `rec-${suffix}` } });
    organizationId = org.id;
    siteId = (await prisma.site.create({ data: { organizationId, name: "Estudio Recordatorio", slug: `rec-sitio-${suffix}` } })).id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    email.messages = [];
    email.failFor.clear();
    await prisma.booking.deleteMany({ where: { siteId } });
  });

  it("recuerda solo las confirmadas de las próximas 24 h, hechas con anticipación, con su enlace firmado", async () => {
    const due = await booking("toca", 20, 48);
    await booking("lejos", 30, 48);
    await booking("muy-cerca", 0.5, 48);
    // Reservó hace 1 h para dentro de 22 h: la confirmación es reciente, no hace falta recordar.
    await booking("recien-hecha", 22, 1);
    await booking("cancelada", 20, 48, { status: "CANCELLED" });

    const sent = await sendDueBookingReminders(prisma, email, { now, publicSiteBaseUrl: "https://impulza.test", bookingLinkSecret: SECRET });
    expect(sent).toBe(1);
    expect(email.messages.map((m) => m.to)).toEqual([due.customerEmail]);
    expect(email.messages[0]!.subject).toBe("Recordatorio: tu reserva en Estudio Recordatorio");
    const token = /\/reserva\/(\S+)/.exec(email.messages[0]!.text)?.[1] ?? "";
    expect(verifyBookingLinkToken(token, SECRET)).toBe(due.id);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: due.id } })).reminderSentAt).toEqual(now);
  });

  it("nunca dos recordatorios, aunque dos ejecuciones se crucen", async () => {
    await booking("una-vez", 10, 48);
    const [first, second] = await Promise.all([sendDueBookingReminders(prisma, email, { now }), sendDueBookingReminders(prisma, email, { now })]);
    expect(first + second).toBe(1);
    expect(await sendDueBookingReminders(prisma, email, { now })).toBe(0);
    expect(email.messages).toHaveLength(1);
  });

  it("si el correo falla, la reserva queda libre para el próximo intento", async () => {
    const failing = await booking("falla", 10, 48);
    email.failFor.add(failing.customerEmail);
    expect(await sendDueBookingReminders(prisma, email, { now })).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: failing.id } })).reminderSentAt).toBeNull();
    email.failFor.clear();
    expect(await sendDueBookingReminders(prisma, email, { now })).toBe(1);
  });

  it("sin URL pública o secreto, el recordatorio sale igual y lo dice en vez de un enlace roto", async () => {
    await booking("sin-enlace", 10, 48);
    await sendDueBookingReminders(prisma, email, { now });
    expect(email.messages[0]!.text).toContain("Responde este correo");
    expect(email.messages[0]!.text).not.toContain("/reserva/");
  });
});
