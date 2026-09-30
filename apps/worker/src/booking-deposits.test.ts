import "./load-dotenv.js";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEPOSIT_RELEASE_GRACE_MS, releaseExpiredDeposits } from "./booking-deposits.js";

// F5.10 — el worker libera las horas cuya seña no se pagó a tiempo, contra la base real: solo las
// vencidas (con margen), nunca una ya pagada, y un solo aviso aunque dos ejecuciones se crucen.

const MINUTE = 60_000;

class RecordingEmail implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

describe("señas vencidas (F5.10)", () => {
  const prisma = new PrismaClient();
  const email = new RecordingEmail();
  const now = new Date("2031-06-02T12:00:00Z");
  let organizationId: string;
  let siteId: string;
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let slot = 0;

  async function pending(label: string, deadlineMinutesAgo: number, extra: Record<string, unknown> = {}) {
    // Cada reserva en su propia hora: la base no deja dos que ocupen el mismo tramo.
    slot += 1;
    const startsAt = new Date(now.getTime() + slot * 60 * MINUTE);
    return prisma.booking.create({
      data: {
        organizationId,
        siteId,
        serviceName: "Sesión",
        durationMinutes: 30,
        priceAmount: 20_000,
        priceCurrency: "CLP",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * MINUTE),
        timeZone: "America/Santiago",
        customerName: label,
        customerEmail: `${label}-${suffix}@deposits.test`,
        status: "PENDING_PAYMENT",
        depositAmount: 5_000,
        paymentDeadline: new Date(now.getTime() - deadlineMinutesAgo * MINUTE),
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: "Señas", slug: `sen-${suffix}` } });
    organizationId = org.id;
    siteId = (await prisma.site.create({ data: { organizationId, name: "Estudio Seña", slug: `sen-sitio-${suffix}` } })).id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    email.messages = [];
    await prisma.booking.deleteMany({ where: { siteId } });
  });

  it("libera solo las vencidas con margen y avisa al cliente; la hora queda libre para otra reserva", async () => {
    const expired = await pending("vencida", 10);
    const inGrace = await pending("en-margen", 2);
    const onTime = await pending("a-tiempo", -20);
    const paid = await pending("pagada", 10, { providerPaymentId: `pago-${suffix}` });

    await releaseExpiredDeposits(prisma, email, now, { organizationId });

    const after = await prisma.booking.findUniqueOrThrow({ where: { id: expired.id } });
    expect(after).toMatchObject({ status: "CANCELLED" });
    expect(after.paymentExpiredAt?.toISOString()).toBe(now.toISOString());
    expect(after.cancelledAt?.toISOString()).toBe(now.toISOString());
    for (const untouched of [inGrace, onTime, paid]) {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: untouched.id } })).status).toBe("PENDING_PAYMENT");
    }
    const mine = email.messages.filter((m) => m.to.endsWith(`${suffix}@deposits.test`));
    expect(mine.map((m) => m.to)).toEqual([expired.customerEmail]);
    expect(mine[0]!.subject).toContain("Se liberó tu hora");
    expect(DEPOSIT_RELEASE_GRACE_MS).toBe(5 * MINUTE);

    // La hora liberada se puede volver a tomar (la restricción de la base ya no la cuenta).
    await prisma.booking.create({
      data: {
        organizationId,
        siteId,
        serviceName: "Sesión",
        durationMinutes: 30,
        startsAt: expired.startsAt,
        endsAt: expired.endsAt,
        timeZone: "America/Santiago",
        customerName: "Otra persona",
        customerEmail: `otra-${suffix}@deposits.test`,
      },
    });
  });

  it("dos ejecuciones cruzadas liberan y avisan una sola vez", async () => {
    const expired = await pending("cruzada", 30);
    await Promise.all([releaseExpiredDeposits(prisma, email, now, { organizationId }), releaseExpiredDeposits(prisma, email, now, { organizationId })]);
    expect(email.messages.filter((m) => m.to === expired.customerEmail)).toHaveLength(1);
  });
});
