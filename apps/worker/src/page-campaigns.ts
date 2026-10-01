import type { PrismaClient } from "@impulza/database";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { logger } from "./observability/logger.js";

export const PAGE_CAMPAIGN_BOUNDARY_QUEUE = "page-campaign-boundaries";
const REVALIDATE_TIMEOUT_MS = 3000;

/** Avisa a apps/web que invalide la caché de un sitio; `true` si respondió bien. */
export type SiteRevalidator = (siteSlug: string) => Promise<boolean>;

/** El mismo webhook firmado que usa la API al publicar (F2.7, `RevalidateWebService`). */
export function httpSiteRevalidator(webAppUrl: string, secret: string): SiteRevalidator {
  return async (siteSlug) => {
    try {
      const response = await fetch(new URL("/api/revalidate", webAppUrl), {
        method: "POST",
        headers: { "content-type": "application/json", "x-revalidate-secret": secret },
        body: JSON.stringify({ siteSlug }),
        signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  };
}

export interface BoundaryResult {
  started: number;
  ended: number;
  sites: number;
  failed: number;
}

/**
 * Modo campaña (F7.7, ADR-022): la página pública se cachea hasta la próxima invalidación, así que
 * al empezar y al terminar cada campaña alguien tiene que avisar. Busca las campañas que cruzaron su
 * inicio o su fin (o se cancelaron) sin aviso, **reclama** cada marca antes de avisar (dos pasadas no
 * avisan dos veces) y, si el aviso falla, la suelta para reintentar en la próxima pasada. Un sitio con
 * varias campañas cruzando a la vez se avisa una sola vez.
 */
export async function revalidatePageCampaignBoundaries(
  prisma: PrismaClient,
  revalidate: SiteRevalidator,
  now: Date = new Date(),
  // Solo para pruebas: acota la pasada a una organización (mismo criterio que los demás trabajos
  // globales del worker), para no tocar las campañas de otras pruebas en la misma base.
  organizationId?: string,
): Promise<BoundaryResult> {
  const due = await prisma.pageCampaign.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      OR: [
        { cancelledAt: null, startsAt: { lte: now }, startRevalidatedAt: null },
        { endRevalidatedAt: null, OR: [{ endsAt: { lte: now } }, { cancelledAt: { not: null } }] },
      ],
    },
    select: { id: true, siteId: true, startsAt: true, endsAt: true, cancelledAt: true, startRevalidatedAt: true, endRevalidatedAt: true, site: { select: { slug: true } } },
  });

  const result: BoundaryResult = { started: 0, ended: 0, sites: 0, failed: 0 };
  const bySite = new Map<string, { slug: string; claims: Array<{ id: string; field: "startRevalidatedAt" | "endRevalidatedAt" }> }>();

  for (const campaign of due) {
    const fields: Array<"startRevalidatedAt" | "endRevalidatedAt"> = [];
    if (campaign.cancelledAt === null && campaign.startsAt <= now && campaign.startRevalidatedAt === null) {
      fields.push("startRevalidatedAt");
    }
    if (campaign.endRevalidatedAt === null && (campaign.endsAt <= now || campaign.cancelledAt !== null)) {
      fields.push("endRevalidatedAt");
    }
    for (const field of fields) {
      const claimed = await prisma.pageCampaign.updateMany({ where: { id: campaign.id, [field]: null }, data: { [field]: now } });
      if (claimed.count === 1) {
        const entry = bySite.get(campaign.siteId) ?? { slug: campaign.site.slug, claims: [] };
        entry.claims.push({ id: campaign.id, field });
        bySite.set(campaign.siteId, entry);
      }
    }
  }

  for (const { slug, claims } of bySite.values()) {
    if (await revalidate(slug)) {
      result.sites += 1;
      result.started += claims.filter((claim) => claim.field === "startRevalidatedAt").length;
      result.ended += claims.filter((claim) => claim.field === "endRevalidatedAt").length;
      continue;
    }
    // Sin aviso, la marca se suelta: la próxima pasada lo vuelve a intentar.
    result.failed += 1;
    for (const claim of claims) {
      await prisma.pageCampaign.updateMany({ where: { id: claim.id, [claim.field]: now }, data: { [claim.field]: null } });
    }
    logger.warn("page_campaign.revalidate_failed", { siteSlug: slug, campaigns: claims.length });
  }

  return result;
}

export interface PageCampaignWorkers {
  close: () => Promise<void>;
}

export async function startPageCampaignWorkers(options: {
  prisma: PrismaClient;
  connection: ConnectionOptions;
  revalidate: SiteRevalidator;
}): Promise<PageCampaignWorkers> {
  const queue = new Queue(PAGE_CAMPAIGN_BOUNDARY_QUEUE, { connection: options.connection });
  await queue.upsertJobScheduler("page-campaign-boundaries-every-minute", { pattern: "15 * * * * *" }, { name: "page-campaign-boundaries" });
  const worker = new Worker(
    PAGE_CAMPAIGN_BOUNDARY_QUEUE,
    async () => {
      const result = await revalidatePageCampaignBoundaries(options.prisma, options.revalidate);
      if (result.sites + result.failed > 0) {
        logger.info("page_campaign.boundaries", { ...result });
      }
      return result;
    },
    { connection: options.connection, concurrency: 1 },
  );
  worker.on("failed", (job, error) => logger.error("page_campaign.boundaries.failed", { jobId: job?.id, err: error }));
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
