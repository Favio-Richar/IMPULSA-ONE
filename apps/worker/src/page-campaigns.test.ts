import "./load-dotenv.js";
import { PrismaClient } from "@impulza/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revalidatePageCampaignBoundaries } from "./page-campaigns.js";

// F7.7 (ADR-022) — el worker avisa a apps/web al empezar y al terminar cada campaña, una sola vez, y
// reintenta si el aviso falla. Contra la base real; el aviso se registra en vez de salir a la red.

const HOUR = 3_600_000;

describe("bordes de las campañas de página en el worker (F7.7)", () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const t0 = new Date("2031-06-01T12:00:00Z");
  let organizationId: string;
  let siteId: string;
  let siteSlug: string;
  let pageIds: string[];

  beforeAll(async () => {
    const organization = await prisma.organization.create({ data: { name: "Org campañas", slug: `org-pc-${suffix}` } });
    organizationId = organization.id;
    siteSlug = `site-pc-${suffix}`;
    const site = await prisma.site.create({ data: { organizationId, name: "Sitio", slug: siteSlug } });
    siteId = site.id;
    pageIds = [];
    for (const slug of ["a", "b", "c"]) {
      pageIds.push((await prisma.page.create({ data: { siteId, slug, position: pageIds.length + 1 } })).id);
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  function campaign(pageId: string, startsAt: Date, endsAt: Date, extra: Record<string, unknown> = {}) {
    return prisma.pageCampaign.create({
      data: { organizationId, siteId, pageId, name: "Campaña", objective: "vender", startsAt, endsAt, utmCampaign: "cyber", ...extra },
    });
  }

  function recorder(ok = true) {
    const calls: string[] = [];
    return { calls, revalidate: async (slug: string) => (calls.push(slug), ok) };
  }

  it("avisa al empezar y al terminar, una sola vez por borde y una sola vez por sitio", async () => {
    const started = await campaign(pageIds[0]!, new Date(t0.getTime() - HOUR), new Date(t0.getTime() + HOUR));
    const ended = await campaign(pageIds[1]!, new Date(t0.getTime() - 3 * HOUR), new Date(t0.getTime() - HOUR));
    const future = await campaign(pageIds[2]!, new Date(t0.getTime() + HOUR), new Date(t0.getTime() + 2 * HOUR));

    const first = recorder();
    const result = await revalidatePageCampaignBoundaries(prisma, first.revalidate, t0, organizationId);
    expect(first.calls).toEqual([siteSlug]);
    // La terminada nunca fue avisada al empezar: se marcan su inicio y su fin.
    expect(result).toMatchObject({ started: 2, ended: 1, sites: 1, failed: 0 });

    const rows = await prisma.pageCampaign.findMany({ where: { organizationId }, orderBy: { startsAt: "asc" } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(started.id)).toMatchObject({ startRevalidatedAt: t0, endRevalidatedAt: null });
    expect(byId.get(ended.id)).toMatchObject({ startRevalidatedAt: t0, endRevalidatedAt: t0 });
    expect(byId.get(future.id)).toMatchObject({ startRevalidatedAt: null, endRevalidatedAt: null });

    // Repetir la misma pasada no vuelve a avisar.
    const again = recorder();
    await revalidatePageCampaignBoundaries(prisma, again.revalidate, t0, organizationId);
    expect(again.calls).toEqual([]);

    // Dos horas después: empieza y termina la futura, y termina la activa.
    const later = new Date(t0.getTime() + 2 * HOUR);
    const next = recorder();
    const second = await revalidatePageCampaignBoundaries(prisma, next.revalidate, later, organizationId);
    expect(next.calls).toEqual([siteSlug]);
    expect(second).toMatchObject({ started: 1, ended: 2, sites: 1 });
    await prisma.pageCampaign.deleteMany({ where: { organizationId } });
  });

  it("una campaña cancelada avisa su fin aunque su fecha de término no haya llegado", async () => {
    const cancelled = await campaign(pageIds[0]!, new Date(t0.getTime() - HOUR), new Date(t0.getTime() + 10 * HOUR), {
      cancelledAt: t0,
      startRevalidatedAt: t0,
    });
    const run = recorder();
    const result = await revalidatePageCampaignBoundaries(prisma, run.revalidate, t0, organizationId);
    expect(run.calls).toEqual([siteSlug]);
    expect(result).toMatchObject({ started: 0, ended: 1 });
    expect((await prisma.pageCampaign.findUniqueOrThrow({ where: { id: cancelled.id } })).endRevalidatedAt).toEqual(t0);
    await prisma.pageCampaign.deleteMany({ where: { organizationId } });
  });

  it("si el aviso falla, suelta la marca y la próxima pasada reintenta", async () => {
    const active = await campaign(pageIds[0]!, new Date(t0.getTime() - HOUR), new Date(t0.getTime() + HOUR));
    const failing = recorder(false);
    const result = await revalidatePageCampaignBoundaries(prisma, failing.revalidate, t0, organizationId);
    expect(result).toMatchObject({ failed: 1, sites: 0, started: 0 });
    expect((await prisma.pageCampaign.findUniqueOrThrow({ where: { id: active.id } })).startRevalidatedAt).toBeNull();

    const retry = recorder();
    await revalidatePageCampaignBoundaries(prisma, retry.revalidate, t0, organizationId);
    expect(retry.calls).toEqual([siteSlug]);
    expect((await prisma.pageCampaign.findUniqueOrThrow({ where: { id: active.id } })).startRevalidatedAt).toEqual(t0);
    await prisma.pageCampaign.deleteMany({ where: { organizationId } });
  });
});
