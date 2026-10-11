import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { EmailAdapter, EmailMessage } from "@impulza/auth";
import type { PrismaClient } from "@impulza/database";
import cookieParser from "cookie-parser";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module.js";
import { PRISMA } from "../../database/prisma.module.js";
import { REDIS } from "../../redis/redis.module.js";
import { listenForTests } from "../../test-support/http.js";
import { assignRoomyPlan } from "../../test-support/plans.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { MembershipLifecycleService } from "./membership-lifecycle.service.js";

// F10.2b (ADR-029) — avisos de renovación y de vencimiento: una vez por compra, solo del último periodo, nunca a quien renovó o fue
// revocado, ni de un pago reembolsado o un sitio que no se sirve.

class FakeEmailAdapter implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DOMAIN = "@membership-lifecycle-e2e.test";
const CSRF = { "X-Requested-With": "impulza-one" };
const PASSWORD = "password1234";
const DAY = 86_400_000;
const unique = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

describe("Avisos de membresía (e2e) — F10.2b / ADR-029", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let emailAdapter: FakeEmailAdapter;
  let lifecycle: MembershipLifecycleService;
  let http: Parameters<typeof request>[0];

  beforeAll(async () => {
    emailAdapter = new FakeEmailAdapter();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EMAIL_ADAPTER).useValue(emailAdapter).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1");
    await app.init();
    http = await listenForTests(app);
    prisma = app.get(PRISMA);
    redis = app.get(REDIS);
    lifecycle = app.get(MembershipLifecycleService);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((user) => user.id) } } });
    await prisma.organization.deleteMany({ where: { memberships: { some: { user: { email: { endsWith: DOMAIN } } } } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  beforeEach(async () => {
    const keys = await redis.keys("ratelimit:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  async function business() {
    const email = `${unique("owner")}${DOMAIN}`;
    await request(http).post("/api/v1/auth/register").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const token = /token=([a-f0-9]+)/.exec(emailAdapter.messages.at(-1)?.text ?? "")?.[1];
    await request(http).post("/api/v1/auth/verify-email").set(CSRF).send({ token }).expect(204);
    const owner = request.agent(http);
    await owner.post("/api/v1/auth/login").set(CSRF).send({ email, password: PASSWORD }).expect(201);
    const org = await owner.post("/api/v1/organizations").set(CSRF).send({ name: "Club Avisos", slug: unique("av-org") }).expect(201);
    const organizationId = org.body.id as string;
    await assignRoomyPlan(prisma, organizationId);
    const site = await owner.post(`/api/v1/organizations/${organizationId}/sites`).set(CSRF).send({ name: "Club Avisos", slug: unique("av-site") }).expect(201);
    const plan = await prisma.membershipPlan.create({
      data: { organizationId, siteId: site.body.id, name: "Club Premium", priceAmount: 5000, priceCurrency: "CLP", period: "MONTHLY" },
    });
    return { organizationId, siteId: site.body.id as string, planId: plan.id };
  }

  let counter = 0;
  async function member(b: Awaited<ReturnType<typeof business>>, overrides: { source?: "INVITED" | "PURCHASED"; status?: "ACTIVE" | "REVOKED" } = {}) {
    counter += 1;
    return prisma.siteMember.create({
      data: {
        organizationId: b.organizationId,
        siteId: b.siteId,
        email: `socia-${counter}-${unique("m")}${DOMAIN}`,
        source: overrides.source ?? "PURCHASED",
        status: overrides.status ?? "ACTIVE",
      },
    });
  }

  async function purchase(
    b: Awaited<ReturnType<typeof business>>,
    memberId: string,
    periodEndInDays: number,
    overrides: { paymentStatus?: string; refundedAmount?: number } = {},
  ) {
    counter += 1;
    const periodEnd = new Date(Date.now() + periodEndInDays * DAY);
    return prisma.membershipPurchase.create({
      data: {
        organizationId: b.organizationId,
        siteId: b.siteId,
        planId: b.planId,
        memberId,
        planName: "Club Premium",
        amount: 5000,
        currency: "CLP",
        periodDays: 30,
        status: "PAID",
        providerPaymentId: `${Date.now()}${counter}${Math.floor(Math.random() * 1000)}`,
        paymentStatus: overrides.paymentStatus ?? "approved",
        refundedAmount: overrides.refundedAmount ?? 0,
        paidAt: new Date(periodEnd.getTime() - 30 * DAY),
        periodStart: new Date(periodEnd.getTime() - 30 * DAY),
        periodEnd,
      },
    });
  }

  const mailsTo = (email: string) => emailAdapter.messages.filter((m) => m.to === email);

  it("recuerda la renovación en la última semana, una sola vez, con el enlace al sitio y sin cobrar nada", async () => {
    const b = await business();
    const m = await member(b);
    const p = await purchase(b, m.id, 3);
    emailAdapter.messages = [];

    const first = await lifecycle.runDue();
    expect(first.reminders).toBeGreaterThanOrEqual(1);
    const mails = mailsTo(m.email);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toContain("vence pronto");
    expect(mails[0]!.text).toContain("Club Premium");
    expect(mails[0]!.text).toContain("no se te cobra nada");
    expect(mails[0]!.text).toMatch(/\/av-site-/);
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: p.id } })).renewalReminderSentAt).not.toBeNull();

    emailAdapter.messages = [];
    await lifecycle.runDue();
    expect(mailsTo(m.email)).toHaveLength(0);
  });

  it("avisa una vez cuando el periodo termina, pero no de lo que venció hace tiempo", async () => {
    const b = await business();
    const recent = await member(b);
    const old = await member(b);
    await purchase(b, recent.id, -1);
    await purchase(b, old.id, -10);
    emailAdapter.messages = [];

    await lifecycle.runDue();
    expect(mailsTo(recent.email)).toHaveLength(1);
    expect(mailsTo(recent.email)[0]!.subject).toContain("terminó");
    expect(mailsTo(recent.email)[0]!.text).toContain("No se te cobró nada");
    expect(mailsTo(old.email)).toHaveLength(0);

    emailAdapter.messages = [];
    await lifecycle.runDue();
    expect(mailsTo(recent.email)).toHaveLength(0);
  });

  it("no avisa a quien ya renovó, a un miembro invitado, a uno revocado ni de un pago reembolsado o en disputa", async () => {
    const b = await business();
    const renewed = await member(b);
    await purchase(b, renewed.id, 3);
    await purchase(b, renewed.id, 33); // renovó: otro periodo termina después
    const invited = await member(b, { source: "INVITED" });
    await purchase(b, invited.id, 3);
    const revoked = await member(b, { status: "REVOKED" });
    await purchase(b, revoked.id, 3);
    const refunded = await member(b);
    await purchase(b, refunded.id, 3, { paymentStatus: "refunded", refundedAmount: 5000 });
    const disputed = await member(b);
    await purchase(b, disputed.id, 3, { paymentStatus: "charged_back" });
    emailAdapter.messages = [];

    await lifecycle.runDue();
    for (const m of [renewed, invited, revoked, refunded, disputed]) {
      expect(mailsTo(m.email), m.email).toHaveLength(0);
    }
  });

  it("no avisa en un sitio despublicado ni de una organización bloqueada", async () => {
    const hidden = await business();
    const m1 = await member(hidden);
    await purchase(hidden, m1.id, 3);
    await prisma.site.update({ where: { id: hidden.siteId }, data: { moderationHiddenAt: new Date() } });

    const blocked = await business();
    const m2 = await member(blocked);
    await purchase(blocked, m2.id, 3);
    await prisma.organization.update({ where: { id: blocked.organizationId }, data: { status: "BLOCKED" } });
    emailAdapter.messages = [];

    await lifecycle.runDue();
    expect(mailsTo(m1.email)).toHaveLength(0);
    expect(mailsTo(m2.email)).toHaveLength(0);
  });

  it("varias pasadas simultáneas (réplicas) avisan una sola vez", async () => {
    const b = await business();
    // Varios miembros y pasadas para que, si el reclamo no fuera condicional, algún aviso se duplicara.
    const members = await Promise.all(Array.from({ length: 5 }, () => member(b)));
    for (const m of members) await purchase(b, m.id, 2);
    emailAdapter.messages = [];
    await Promise.all(Array.from({ length: 6 }, () => lifecycle.runDue()));
    for (const m of members) expect(mailsTo(m.email), m.email).toHaveLength(1);
  });

  it("un fallo del correo no repite el aviso ni rompe la pasada", async () => {
    const b = await business();
    const m = await member(b);
    const p = await purchase(b, m.id, 2);
    const original = emailAdapter.send.bind(emailAdapter);
    emailAdapter.send = async (message: EmailMessage) => {
      if (message.to === m.email) throw new Error("correo caído");
      return original(message);
    };
    try {
      await expect(lifecycle.runDue()).resolves.toBeDefined();
    } finally {
      emailAdapter.send = original;
    }
    // El aviso quedó marcado: no se reintenta a ciegas (a lo más una vez, nunca en bucle).
    expect((await prisma.membershipPurchase.findUniqueOrThrow({ where: { id: p.id } })).renewalReminderSentAt).not.toBeNull();
  });
});
