import "./load-dotenv.js";
import { verifyUnsubscribeToken, type EmailAdapter, type EmailMessage } from "@impulza/auth";
import { PrismaClient } from "@impulza/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dispatchCampaigns } from "./campaign-dispatch.js";

// F5.6 — despacho de campañas contra la base real: límite por hora, baja de último momento, fallos
// del proveedor, cierre de la campaña y nunca dos correos al mismo destinatario.

const SECRET = "c".repeat(32);
const BASE = "https://impulza.test";

class RecordingEmail implements EmailAdapter {
  messages: EmailMessage[] = [];
  failFor = new Set<string>();
  async send(message: EmailMessage): Promise<void> {
    if (this.failFor.has(message.to)) throw new Error("proveedor caído");
    this.messages.push(message);
  }
}

describe("despacho de campañas (F5.6)", () => {
  const prisma = new PrismaClient();
  const email = new RecordingEmail();
  const now = new Date("2031-06-01T12:00:00Z");
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let organizationId: string;

  async function campaignWith(count: number, emailsPerHour: number | null) {
    const campaign = await prisma.campaign.create({
      data: {
        organizationId,
        name: "Promo",
        subject: "Nuevas velas",
        bodyHtml: "<p>Llegaron las velas de otoño.</p>",
        segment: { tags: [], sources: [], commercialStatuses: [] },
        status: "SENDING",
        recipientCount: count,
        emailsPerHour,
        sendStartedAt: now,
      },
    });
    const contacts = [];
    for (let i = 0; i < count; i++) {
      const address = `c${i}-${Math.random().toString(36).slice(2, 7)}-${suffix}@dispatch.test`;
      const contact = await prisma.contact.create({ data: { organizationId, email: address, marketingConsentAt: now } });
      contacts.push(contact);
      await prisma.campaignRecipient.create({ data: { campaignId: campaign.id, organizationId, contactId: contact.id, email: address } });
    }
    return { campaign, contacts };
  }

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Tienda <Despacho>", slug: `desp-${suffix}` } })).id;
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    email.messages = [];
    email.failFor.clear();
    await prisma.campaign.deleteMany({ where: { organizationId } });
    await prisma.contact.deleteMany({ where: { organizationId } });
  });

  it("envía con el enlace de baja firmado (texto, HTML y cabecera de un clic) y cierra la campaña", async () => {
    const { campaign } = await campaignWith(3, null);
    const sent = await dispatchCampaigns(prisma, email, { now, publicSiteBaseUrl: BASE, linkSecret: SECRET });
    expect(sent).toBe(3);
    const message = email.messages[0]!;
    expect(message.subject).toBe("Nuevas velas");
    expect(message.text).toContain("Llegaron las velas de otoño.");
    expect(message.text).toContain("aceptaste recibir novedades de Tienda <Despacho>");
    const token = new RegExp(`${BASE}/baja/(\\S+)`).exec(message.text)?.[1] ?? "";
    const recipient = await prisma.campaignRecipient.findFirstOrThrow({ where: { email: message.to } });
    expect(verifyUnsubscribeToken(token, SECRET)).toBe(recipient.id);
    expect(message.html).toContain(`${BASE}/baja/${token}`);
    expect(message.headers?.["List-Unsubscribe"]).toBe(`<${BASE}/api/unsubscribe/${token}>`);
    expect(message.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const done = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(done.status).toBe("SENT");
    expect(done.sentAt).toEqual(now);
    // Otra pasada no vuelve a enviar nada.
    expect(await dispatchCampaigns(prisma, email, { now, publicSiteBaseUrl: BASE, linkSecret: SECRET })).toBe(0);
    expect(email.messages).toHaveLength(3);
  });

  it("respeta el límite por hora de la organización y sigue en la hora siguiente", async () => {
    const { campaign } = await campaignWith(5, 2);
    expect(await dispatchCampaigns(prisma, email, { now, publicSiteBaseUrl: BASE, linkSecret: SECRET })).toBe(2);
    expect(await dispatchCampaigns(prisma, email, { now: new Date(now.getTime() + 60_000), publicSiteBaseUrl: BASE, linkSecret: SECRET })).toBe(0);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("SENDING");
    const later = new Date(now.getTime() + 61 * 60_000);
    expect(await dispatchCampaigns(prisma, email, { now: later, publicSiteBaseUrl: BASE, linkSecret: SECRET })).toBe(2);
    expect(await prisma.campaignRecipient.count({ where: { campaignId: campaign.id, status: "PENDING" } })).toBe(1);
  });

  it("quien se dio de baja entre el alta del envío y su turno no recibe nada; un fallo queda registrado", async () => {
    const { campaign, contacts } = await campaignWith(3, null);
    await prisma.contact.update({ where: { id: contacts[0]!.id }, data: { marketingUnsubscribedAt: now } });
    email.failFor.add(contacts[1]!.email!);
    expect(await dispatchCampaigns(prisma, email, { now, publicSiteBaseUrl: BASE, linkSecret: SECRET })).toBe(1);
    const statuses = await prisma.campaignRecipient.findMany({ where: { campaignId: campaign.id }, orderBy: { email: "asc" }, select: { status: true, error: true } });
    expect(statuses.map((r) => r.status)).toEqual(["SKIPPED", "FAILED", "SENT"]);
    expect(statuses[1]!.error).toBe("proveedor caído");
    expect(email.messages.map((m) => m.to)).toEqual([contacts[2]!.email]);
  });

  it("dos pasadas simultáneas nunca envían dos veces al mismo destinatario", async () => {
    await campaignWith(6, null);
    const [a, b] = await Promise.all([
      dispatchCampaigns(prisma, email, { now, publicSiteBaseUrl: BASE, linkSecret: SECRET }),
      dispatchCampaigns(prisma, email, { now, publicSiteBaseUrl: BASE, linkSecret: SECRET }),
    ]);
    expect(a + b).toBe(6);
    expect(new Set(email.messages.map((m) => m.to)).size).toBe(6);
    expect(email.messages).toHaveLength(6);
  });

  it("sin URL pública o sin secreto no envía nada: todo correo lleva su enlace de baja", async () => {
    await campaignWith(1, null);
    expect(await dispatchCampaigns(prisma, email, { now })).toBe(0);
    expect(email.messages).toEqual([]);
  });
});
