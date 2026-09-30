import "./load-dotenv.js";
import { decryptSecret, encryptSecret, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import { FakeMercadoPagoOAuth } from "@impulza/payments";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { refreshPaymentAccounts } from "./payment-accounts.js";

// F5.8 — renovación de los tokens de las cuentas de Mercado Pago de los negocios, contra la base real.

class RecordingEmail implements EmailAdapter {
  messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
}

const DAY = 24 * 3_600_000;

describe("renovación de cuentas de cobro (F5.8)", () => {
  const prisma = new PrismaClient();
  const email = new RecordingEmail();
  const oauth = new FakeMercadoPagoOAuth();
  const encryptionKey = process.env.AUTH_ENCRYPTION_KEY!;
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const ownerEmail = `owner-${suffix}@payment-accounts-worker.test`;
  const organizationIds: string[] = [];
  let ownerId: string;
  let ownerRoleId: string;

  function run(now = new Date()) {
    return refreshPaymentAccounts(prisma, { oauth, email, encryptionKey, dashboardBaseUrl: "http://panel.test", scope: { organizationIds }, now });
  }

  async function connected(expiresInDays: number) {
    const organization = await prisma.organization.create({ data: { name: "Café Luna", slug: `cafe-${suffix}-${organizationIds.length}` } });
    organizationIds.push(organization.id);
    await prisma.membership.create({ data: { organizationId: organization.id, userId: ownerId, roleId: ownerRoleId, status: "ACTIVE" } });
    return prisma.paymentAccount.create({
      data: {
        organizationId: organization.id,
        provider: "MERCADO_PAGO",
        providerUserId: "12345",
        accessTokenEncrypted: encryptSecret("APP_USR-viejo", encryptionKey),
        refreshTokenEncrypted: encryptSecret("TG-viejo", encryptionKey),
        expiresAt: new Date(Date.now() + expiresInDays * DAY),
        liveMode: true,
      },
    });
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: ownerEmail, passwordHash: "x", emailVerifiedAt: new Date() } })).id;
    ownerRoleId = (await prisma.role.findUniqueOrThrow({ where: { name: "OWNER" } })).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { email: ownerEmail } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    email.messages = [];
    oauth.failRefresh = false;
  });

  it("renueva antes de vencer y guarda los tokens nuevos cifrados", async () => {
    const account = await connected(10);
    expect(await run()).toMatchObject({ renewed: 1 });
    const after = await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(decryptSecret(after.accessTokenEncrypted, encryptionKey)).toMatch(/^APP_USR-access-/);
    expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + 170 * DAY);
    expect(after.lastRefreshedAt).not.toBeNull();
  });

  it("no toca las que vencen lejos", async () => {
    const account = await connected(120);
    await run();
    expect(decryptSecret((await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } })).accessTokenEncrypted, encryptionKey)).toBe("APP_USR-viejo");
  });

  it("si Mercado Pago rechaza la renovación: queda en error, avisa al dueño una sola vez y no entrega el token", async () => {
    const account = await connected(5);
    oauth.failRefresh = true;
    await run();
    await run();
    expect(await prisma.paymentAccount.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({ status: "ERROR", lastError: "refresh_rejected" });
    expect(email.messages.filter((m) => m.to === ownerEmail && m.subject === "Reconecta tu cuenta de Mercado Pago")).toHaveLength(1);
  });
});
