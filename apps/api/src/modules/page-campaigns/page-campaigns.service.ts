import { ConflictException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PageCampaignReportResponse, PageCampaignResponse } from "@impulza/contracts";
import { Prisma, type PageCampaign, type PrismaClient } from "@impulza/database";
import {
  PAGE_CAMPAIGN_MAX_DAYS,
  PAGE_CAMPAIGN_MAX_PER_SITE,
  pageCampaignStatus,
  type CreatePageCampaignInput,
  type UpdatePageCampaignInput,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";

export const PAGE_CAMPAIGN_PAGE_INVALID = "PAGE_CAMPAIGN_PAGE_INVALID";
export const PAGE_CAMPAIGN_OVERLAP = "PAGE_CAMPAIGN_OVERLAP";
export const HOME_TAKEOVER_OVERLAP = "HOME_TAKEOVER_OVERLAP";
export const PAGE_CAMPAIGN_LIMIT_REACHED = "PAGE_CAMPAIGN_LIMIT_REACHED";
export const PAGE_CAMPAIGN_CLOSED = "PAGE_CAMPAIGN_CLOSED";
export const PAGE_CAMPAIGN_WINDOW_INVALID = "PAGE_CAMPAIGN_WINDOW_INVALID";

const DAY_MS = 24 * 60 * 60 * 1000;

function unprocessable(code: string, message: string, path?: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    error: "Unprocessable Entity",
    code,
    message,
    ...(path ? { issues: [{ path, message }] } : {}),
  });
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ statusCode: HttpStatus.CONFLICT, error: "Conflict", code, message });
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

type CampaignWithPage = PageCampaign & { page: { slug: string; deletedAt: Date | null } };

/**
 * Modo campaña (F7.7, ADR-022). Todo dentro del sitio ya verificado en la organización de la ruta
 * (ADR-002). Cada cambio que altera lo que ve el público (crear, editar, cancelar, borrar) invalida
 * la caché del sitio en `apps/web` al instante; el empiece y el fin los avisa el worker.
 */
@Injectable()
export class PageCampaignsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly revalidateWeb: RevalidateWebService,
  ) {}

  private async assertSite(organizationId: string, siteId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true } });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
  }

  private async getOrThrow(organizationId: string, siteId: string, campaignId: string): Promise<CampaignWithPage> {
    const campaign = await this.prisma.pageCampaign.findFirst({
      where: { id: campaignId, organizationId, siteId },
      include: { page: { select: { slug: true, deletedAt: true } } },
    });
    if (!campaign) {
      throw new NotFoundException("Campaña no encontrada.");
    }
    return campaign;
  }

  private toResponse(campaign: CampaignWithPage, now = new Date()): PageCampaignResponse {
    return {
      id: campaign.id,
      siteId: campaign.siteId,
      pageId: campaign.pageId,
      pageSlug: campaign.page.deletedAt === null ? campaign.page.slug : null,
      name: campaign.name,
      objective: campaign.objective as PageCampaignResponse["objective"],
      startsAt: campaign.startsAt.toISOString(),
      endsAt: campaign.endsAt.toISOString(),
      replaceHome: campaign.replaceHome,
      utmCampaign: campaign.utmCampaign,
      status: pageCampaignStatus(campaign, now),
      cancelledAt: campaign.cancelledAt?.toISOString() ?? null,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
    };
  }

  /** La página tiene que ser de este sitio, no estar en la papelera, no ser el inicio y estar publicada. */
  private async assertPage(siteId: string, pageId: string): Promise<void> {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, siteId, deletedAt: null },
      select: { isHome: true, _count: { select: { versions: true } } },
    });
    if (!page) {
      throw unprocessable(PAGE_CAMPAIGN_PAGE_INVALID, "Esa página no es de este sitio.", "pageId");
    }
    if (page.isHome) {
      throw unprocessable(PAGE_CAMPAIGN_PAGE_INVALID, "La página de inicio no puede ser una campaña: elige otra página.", "pageId");
    }
    if (page._count.versions === 0) {
      throw unprocessable(PAGE_CAMPAIGN_PAGE_INVALID, "Publica la página antes de usarla en una campaña.", "pageId");
    }
  }

  /**
   * Solapes (ADR-022 §4), dentro de la transacción con el bloqueo por sitio: una página en una sola
   * campaña a la vez y una sola campaña tomando el inicio a la vez. Las canceladas no cuentan.
   */
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    siteId: string,
    candidate: { id: string | null; pageId: string; startsAt: Date; endsAt: Date; replaceHome: boolean },
  ): Promise<void> {
    const overlapping = {
      siteId,
      cancelledAt: null,
      startsAt: { lt: candidate.endsAt },
      endsAt: { gt: candidate.startsAt },
      ...(candidate.id ? { id: { not: candidate.id } } : {}),
    };
    if (await tx.pageCampaign.findFirst({ where: { ...overlapping, pageId: candidate.pageId }, select: { id: true } })) {
      throw conflict(PAGE_CAMPAIGN_OVERLAP, "Esa página ya está en otra campaña en esas fechas.");
    }
    if (candidate.replaceHome && (await tx.pageCampaign.findFirst({ where: { ...overlapping, replaceHome: true }, select: { id: true } }))) {
      throw conflict(HOME_TAKEOVER_OVERLAP, "Otra campaña ya toma el inicio del sitio en esas fechas.");
    }
  }

  private lockSite(tx: Prisma.TransactionClient, siteId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`page-campaigns:${siteId}`}, 0))`;
  }

  async list(organizationId: string, siteId: string): Promise<PageCampaignResponse[]> {
    await this.assertSite(organizationId, siteId);
    const campaigns = await this.prisma.pageCampaign.findMany({
      where: { organizationId, siteId },
      include: { page: { select: { slug: true, deletedAt: true } } },
      orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    });
    const now = new Date();
    return campaigns.map((campaign) => this.toResponse(campaign, now));
  }

  async get(organizationId: string, siteId: string, campaignId: string): Promise<PageCampaignResponse> {
    return this.toResponse(await this.getOrThrow(organizationId, siteId, campaignId));
  }

  async create(organizationId: string, actorId: string, siteId: string, input: CreatePageCampaignInput): Promise<PageCampaignResponse> {
    await this.assertSite(organizationId, siteId);
    await this.assertPage(siteId, input.pageId);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt.getTime() <= Date.now()) {
      throw unprocessable(PAGE_CAMPAIGN_WINDOW_INVALID, "El fin de la campaña ya pasó: elige fechas futuras.", "endsAt");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockSite(tx, siteId);
      if ((await tx.pageCampaign.count({ where: { siteId } })) >= PAGE_CAMPAIGN_MAX_PER_SITE) {
        throw unprocessable(PAGE_CAMPAIGN_LIMIT_REACHED, `Un sitio puede tener hasta ${PAGE_CAMPAIGN_MAX_PER_SITE} campañas. Borra una terminada para crear otra.`);
      }
      await this.assertNoOverlap(tx, siteId, { id: null, pageId: input.pageId, startsAt, endsAt, replaceHome: input.replaceHome });
      return tx.pageCampaign.create({
        data: {
          organizationId,
          siteId,
          pageId: input.pageId,
          name: input.name,
          objective: input.objective,
          startsAt,
          endsAt,
          replaceHome: input.replaceHome,
          utmCampaign: input.utmCampaign,
        },
        include: { page: { select: { slug: true, deletedAt: true } } },
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "page_campaign.created",
      targetType: "PageCampaign",
      targetId: created.id,
      metadata: { siteId, pageId: created.pageId, startsAt: input.startsAt, endsAt: input.endsAt, replaceHome: created.replaceHome },
    });
    logger.info("campaña de página creada", { organizationId, siteId, campaignId: created.id, replaceHome: created.replaceHome });
    // La página pasa a ser temporal desde ya (se oculta hasta su inicio): el público lo ve al instante.
    await this.revalidateWeb.revalidateSite(siteId);
    return this.toResponse(created);
  }

  async update(
    organizationId: string,
    actorId: string,
    siteId: string,
    campaignId: string,
    input: UpdatePageCampaignInput,
  ): Promise<PageCampaignResponse> {
    const current = await this.getOrThrow(organizationId, siteId, campaignId);
    const status = pageCampaignStatus(current);
    if (status === "ended" || status === "cancelled") {
      throw conflict(PAGE_CAMPAIGN_CLOSED, "Una campaña terminada o cancelada ya no se edita: crea otra.");
    }
    const pageId = input.pageId ?? current.pageId;
    if (input.pageId !== undefined && input.pageId !== current.pageId) {
      await this.assertPage(siteId, pageId);
    }
    const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
    const endsAt = input.endsAt ? new Date(input.endsAt) : current.endsAt;
    const now = Date.now();
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw unprocessable(PAGE_CAMPAIGN_WINDOW_INVALID, "El fin tiene que ser después del inicio.", "endsAt");
    }
    if (endsAt.getTime() - startsAt.getTime() > PAGE_CAMPAIGN_MAX_DAYS * DAY_MS) {
      throw unprocessable(PAGE_CAMPAIGN_WINDOW_INVALID, `Una campaña dura como máximo ${PAGE_CAMPAIGN_MAX_DAYS} días.`, "endsAt");
    }
    if (endsAt.getTime() <= now) {
      throw unprocessable(PAGE_CAMPAIGN_WINDOW_INVALID, "El nuevo fin ya pasó. Para terminarla ahora, cancélala.", "endsAt");
    }
    const replaceHome = input.replaceHome ?? current.replaceHome;

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockSite(tx, siteId);
      await this.assertNoOverlap(tx, siteId, { id: current.id, pageId, startsAt, endsAt, replaceHome });
      return tx.pageCampaign.update({
        where: { id: current.id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.objective === undefined ? {} : { objective: input.objective }),
          ...(input.utmCampaign === undefined ? {} : { utmCampaign: input.utmCampaign }),
          pageId,
          startsAt,
          endsAt,
          replaceHome,
          // Si una fecha se movió al futuro, el worker tiene que volver a avisar cuando llegue.
          ...(startsAt.getTime() > now ? { startRevalidatedAt: null } : {}),
          endRevalidatedAt: null,
        },
        include: { page: { select: { slug: true, deletedAt: true } } },
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "page_campaign.updated",
      targetType: "PageCampaign",
      targetId: current.id,
      metadata: { siteId, fields: Object.keys(input) },
    });
    await this.revalidateWeb.revalidateSite(siteId);
    return this.toResponse(updated);
  }

  /** Termina ahora una campaña programada o activa: la página deja de servirse y la raíz vuelve al inicio. */
  async cancel(organizationId: string, actorId: string, siteId: string, campaignId: string): Promise<PageCampaignResponse> {
    const current = await this.getOrThrow(organizationId, siteId, campaignId);
    const status = pageCampaignStatus(current);
    if (status === "ended" || status === "cancelled") {
      throw conflict(PAGE_CAMPAIGN_CLOSED, "La campaña ya terminó.");
    }
    const cancelled = await this.prisma.pageCampaign.update({
      where: { id: current.id },
      data: { cancelledAt: new Date() },
      include: { page: { select: { slug: true, deletedAt: true } } },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "page_campaign.cancelled",
      targetType: "PageCampaign",
      targetId: current.id,
      metadata: { siteId, previousStatus: status },
    });
    await this.revalidateWeb.revalidateSite(siteId);
    return this.toResponse(cancelled);
  }

  async remove(organizationId: string, actorId: string, siteId: string, campaignId: string): Promise<void> {
    const current = await this.getOrThrow(organizationId, siteId, campaignId);
    await this.prisma.pageCampaign.delete({ where: { id: current.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "page_campaign.deleted",
      targetType: "PageCampaign",
      targetId: current.id,
      metadata: { siteId, name: current.name, status: pageCampaignStatus(current) },
    });
    await this.revalidateWeb.revalidateSite(siteId);
  }

  /**
   * Reporte separado (ADR-022 §7, mismo criterio que ADR-021): visitas del día que vieron la página
   * de la campaña dentro de la ventana y, de ellas, cuántas después hicieron cada cosa. El pago se
   * cruza con pedidos y reservas pagados por la clave de idempotencia del evento.
   */
  async report(organizationId: string, siteId: string, campaignId: string): Promise<PageCampaignReportResponse> {
    const campaign = await this.getOrThrow(organizationId, siteId, campaignId);
    const now = new Date();
    const closedAt = campaign.cancelledAt && campaign.cancelledAt < campaign.endsAt ? campaign.cancelledAt : campaign.endsAt;
    const to = new Date(Math.max(campaign.startsAt.getTime(), Math.min(now.getTime(), closedAt.getTime())));
    const from = campaign.startsAt;

    const landing = Prisma.sql`
      SELECT e.anonymized_visitor_id AS v, MIN(e.created_at) AS t
      FROM analytics_events e
      WHERE e.site_id = ${siteId}::uuid AND e.type = 'page_view' AND e.subject_id = ${campaign.pageId}
        AND e.created_at >= ${from} AND e.created_at < ${to} AND e.anonymized_visitor_id IS NOT NULL
      GROUP BY e.anonymized_visitor_id`;
    const after = (types: string[]) => Prisma.sql`
      SELECT COUNT(DISTINCT e.anonymized_visitor_id)::int FROM analytics_events e
      JOIN landing l ON l.v = e.anonymized_visitor_id AND e.created_at >= l.t
      WHERE e.site_id = ${siteId}::uuid AND e.type IN (${Prisma.join(types)})`;

    const startedAt = performance.now();
    const [totals] = await this.prisma.$queryRaw<
      Array<{ visitors: number; interactions: number; leads: number; bookings: number; orders: number; converted: number; payments: number }>
    >`
      WITH landing AS (${landing})
      SELECT
        (SELECT COUNT(*)::int FROM landing) AS visitors,
        (${after(["block_click", "whatsapp_click"])}) AS interactions,
        (${after(["lead_created"])}) AS leads,
        (${after(["booking_created"])}) AS bookings,
        (${after(["order_created"])}) AS orders,
        (${after(["lead_created", "booking_created", "order_created"])}) AS converted,
        (SELECT COUNT(DISTINCT p.v)::int FROM (
          SELECT e.anonymized_visitor_id AS v, o.paid_at AS t FROM analytics_events e
          JOIN orders o ON e.idempotency_key = 'order_created:' || o.id::text AND o.site_id = e.site_id
          WHERE e.site_id = ${siteId}::uuid AND e.type = 'order_created' AND o.paid_at IS NOT NULL
          UNION ALL
          SELECT e.anonymized_visitor_id, b.deposit_paid_at FROM analytics_events e
          JOIN bookings b ON e.idempotency_key = 'booking_created:' || b.id::text AND b.site_id = e.site_id
          WHERE e.site_id = ${siteId}::uuid AND e.type = 'booking_created' AND b.deposit_paid_at IS NOT NULL
        ) p JOIN landing l ON l.v = p.v AND p.t >= l.t) AS payments`;
    const sources = await this.prisma.$queryRaw<Array<{ source: string | null; visitors: number }>>`
      WITH landing AS (${landing})
      SELECT NULLIF(e.utm->>'source', '') AS source, COUNT(DISTINCT e.anonymized_visitor_id)::int AS visitors
      FROM analytics_events e
      JOIN landing l ON l.v = e.anonymized_visitor_id AND e.created_at = l.t
      WHERE e.site_id = ${siteId}::uuid AND e.type = 'page_view' AND e.subject_id = ${campaign.pageId}
      GROUP BY 1
      ORDER BY visitors DESC, source ASC NULLS LAST`;
    logger.info("reporte de campaña calculado", { organizationId, siteId, campaignId, durationMs: Math.round(performance.now() - startedAt) });

    const visitors = totals?.visitors ?? 0;
    return {
      campaignId: campaign.id,
      from: from.toISOString(),
      to: to.toISOString(),
      visitors,
      interactions: totals?.interactions ?? 0,
      leads: totals?.leads ?? 0,
      bookings: totals?.bookings ?? 0,
      orders: totals?.orders ?? 0,
      payments: totals?.payments ?? 0,
      conversion: ratio(totals?.converted ?? 0, visitors),
      sources: sources.map((row) => ({ source: row.source, visitors: row.visitors })),
    };
  }
}
