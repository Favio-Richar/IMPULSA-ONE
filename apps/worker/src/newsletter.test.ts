import "./load-dotenv.js";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@impulza/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeNewsletterConfirmations } from "./newsletter.js";

// F7.4 (ADR-019 §4): la purga borra solo lo que ya no hace falta, contra la base real y dentro de su
// organización.

const DAY = 24 * 3_600_000;

describe("purga de solicitudes de newsletter (F7.4)", () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date("2031-03-10T12:00:00Z");
  let organizationId: string;
  let otherOrganizationId: string;
  let siteId: string;
  let otherSiteId: string;

  async function row(organization: string, site: string, label: string, createdDaysAgo: number, confirmed: boolean) {
    const createdAt = new Date(now.getTime() - createdDaysAgo * DAY);
    return prisma.newsletterConfirmation.create({
      data: {
        organizationId: organization,
        siteId: site,
        email: `${label}-${suffix}@newsletter-worker.test`,
        tokenHash: randomBytes(32).toString("hex"),
        consentTextVersion: "newsletter-v1",
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 2 * DAY),
        confirmedAt: confirmed ? new Date(createdAt.getTime() + 3_600_000) : null,
      },
    });
  }

  beforeAll(async () => {
    organizationId = (await prisma.organization.create({ data: { name: "Newsletter", slug: `nl-${suffix}` } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Otra", slug: `nl-otra-${suffix}` } })).id;
    siteId = (await prisma.site.create({ data: { organizationId, name: "Sitio", slug: `nl-sitio-${suffix}` } })).id;
    otherSiteId = (await prisma.site.create({ data: { organizationId: otherOrganizationId, name: "Otro", slug: `nl-otro-${suffix}` } })).id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
    await prisma.$disconnect();
  });

  it("borra las no confirmadas vencidas hace más de un día y las confirmadas de más de 30 días; nada más", async () => {
    const freshPending = await row(organizationId, siteId, "pendiente", 1, false);
    const justExpired = await row(organizationId, siteId, "recien-vencida", 2.5, false);
    const longExpired = await row(organizationId, siteId, "vencida", 4, false);
    const recentConfirmed = await row(organizationId, siteId, "confirmada", 10, true);
    const oldConfirmed = await row(organizationId, siteId, "confirmada-vieja", 40, true);
    const otherOrg = await row(otherOrganizationId, otherSiteId, "otra-org", 40, true);

    expect(await purgeNewsletterConfirmations(prisma, now, { organizationId })).toEqual({ unconfirmed: 1, confirmed: 1 });
    const left = new Set((await prisma.newsletterConfirmation.findMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } })).map((r) => r.id));
    expect(left).toEqual(new Set([freshPending.id, justExpired.id, recentConfirmed.id, otherOrg.id]));
    expect(left.has(longExpired.id) || left.has(oldConfirmed.id)).toBe(false);
  });
});
