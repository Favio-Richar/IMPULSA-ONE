import { Inject, Injectable } from "@nestjs/common";
import type { AgencyDashboardResponse, AgencyOverviewItem, AgencyOverviewResponse } from "@impulza/contracts";
import { AgencyClientStatus, BookingStatus, DomainVerificationStatus, OrderStatus, SiteStatus, type Prisma, type PrismaClient } from "@impulza/database";
import {
  buildClientAlerts,
  countByStatus,
  countsTowardsTotals,
  dashboardRange,
  isNearLimit,
  type AgencyDashboardQuery,
  type AgencyOverviewQuery,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { PlansService } from "../plans/plans.service.js";
import { AgencyService } from "./agency.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CLICK_METRICS = ["block_click", "whatsapp_click"] as const;

type Performance = NonNullable<AgencyOverviewItem["performance"]>;
interface ClientHealth {
  plan: NonNullable<AgencyOverviewItem["plan"]>;
  domains: NonNullable<AgencyOverviewItem["domains"]>;
  lastPublishedAt: Date | null;
  siteCount: number;
  publicHidden: boolean;
  alerts: AgencyOverviewItem["alerts"];
  nearLimit: boolean;
}

const emptyPerformance = (): Performance => ({ pageViews: 0, clicks: 0, newContacts: 0, bookings: 0, orders: 0 });

/**
 * Panel de agencia (F9.4, ADR-028 §2). Consolida **solo** los clientes `ACTIVE` de la agencia (un cliente en pausa, archivado
 * o sin aceptar no suma) y nunca expone nada de la suscripción ni de los pagos del cliente (límite duro de la delegación).
 * Todo se calcula con consultas agrupadas sobre la lista de organizaciones: el número de consultas no crece con los clientes.
 */
@Injectable()
export class AgencyDashboardService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly plans: PlansService,
    private readonly agency: AgencyService,
  ) {}

  async dashboard(agencyOrganizationId: string, query: AgencyDashboardQuery): Promise<AgencyDashboardResponse> {
    await this.agency.assertAgency(agencyOrganizationId);
    const range = { ...dashboardRange(query.days, new Date()), days: query.days };

    const relations = await this.prisma.agencyClient.findMany({
      where: { agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } },
      select: { status: true, clientOrganizationId: true },
    });
    const activeIds = relations.filter((relation) => countsTowardsTotals(relation.status)).map((relation) => relation.clientOrganizationId);

    const [performance, health] = await Promise.all([this.performanceFor(activeIds, range), this.healthFor(activeIds)]);

    const totals = emptyPerformance();
    for (const row of performance.values()) {
      totals.pageViews += row.pageViews;
      totals.clicks += row.clicks;
      totals.newContacts += row.newContacts;
      totals.bookings += row.bookings;
      totals.orders += row.orders;
    }
    let clientsWithAlerts = 0;
    let domainsFailed = 0;
    let domainsPending = 0;
    let clientsNearPlanLimit = 0;
    for (const row of health.values()) {
      if (row.alerts.length > 0) clientsWithAlerts += 1;
      domainsFailed += row.domains.failed;
      domainsPending += row.domains.pending;
      if (row.nearLimit) clientsNearPlanLimit += 1;
    }

    return {
      range,
      clients: { total: relations.length, byStatus: countByStatus(relations.map((relation) => relation.status)) },
      totals,
      alerts: { clientsWithAlerts, domainsFailed, domainsPending, clientsNearPlanLimit },
    };
  }

  async overview(agencyOrganizationId: string, query: AgencyOverviewQuery): Promise<AgencyOverviewResponse> {
    await this.agency.assertAgency(agencyOrganizationId);
    const range = { ...dashboardRange(query.days, new Date()), days: query.days };

    const where: Prisma.AgencyClientWhereInput = {
      agencyOrganizationId,
      // Las relaciones terminadas nunca aparecen, tampoco al filtrar por estado.
      AND: [{ status: { not: AgencyClientStatus.ENDED } }, ...(query.status ? [{ status: query.status }] : [])],
      ...(query.search
        ? {
            clientOrganization: {
              OR: [{ name: { contains: query.search, mode: "insensitive" as const } }, { slug: { contains: query.search, mode: "insensitive" as const } }],
            },
          }
        : {}),
    };
    const orderBy: Prisma.AgencyClientOrderByWithRelationInput[] = [
      query.sort === "name" ? { clientOrganization: { name: query.order } } : query.sort === "status" ? { status: query.order } : { createdAt: query.order },
      { id: "asc" },
    ];

    const [total, relations] = await Promise.all([
      this.prisma.agencyClient.count({ where }),
      this.prisma.agencyClient.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { clientOrganization: { select: { id: true, name: true, slug: true, publicHiddenAt: true } } },
      }),
    ]);

    // Solo se mide a los clientes ACTIVE de esta página.
    const activeIds = relations.filter((relation) => countsTowardsTotals(relation.status)).map((relation) => relation.clientOrganizationId);
    const [performance, health] = await Promise.all([this.performanceFor(activeIds, range), this.healthFor(activeIds)]);

    const items: AgencyOverviewItem[] = relations.map((relation) => {
      const clientId = relation.clientOrganizationId;
      const measured = countsTowardsTotals(relation.status);
      const clientHealth = health.get(clientId);
      return {
        id: relation.id,
        clientOrganizationId: clientId,
        clientName: relation.clientOrganization.name,
        clientSlug: relation.clientOrganization.slug,
        status: relation.status,
        billingMode: relation.billingMode,
        agencyCreated: relation.agencyCreated,
        ownerInviteEmail: relation.ownerInviteEmail,
        readOnly: relation.status === AgencyClientStatus.PAUSED,
        publicHidden: relation.clientOrganization.publicHiddenAt !== null,
        performance: measured ? (performance.get(clientId) ?? emptyPerformance()) : null,
        plan: measured ? (clientHealth?.plan ?? null) : null,
        domains: measured ? (clientHealth?.domains ?? null) : null,
        lastPublishedAt: measured ? (clientHealth?.lastPublishedAt?.toISOString() ?? null) : null,
        alerts: measured ? (clientHealth?.alerts ?? []) : [],
      };
    });

    return { range, page: query.page, pageSize: query.pageSize, total, items };
  }

  // ---- consultas agrupadas ---------------------------------------------------------------------------------------

  /** Visitas, clics, contactos nuevos, reservas y pedidos del período, por organización (5 consultas, sin importar cuántas). */
  private async performanceFor(organizationIds: string[], range: { from: string; to: string }): Promise<Map<string, Performance>> {
    const result = new Map<string, Performance>();
    if (organizationIds.length === 0) return result;
    const at = (id: string): Performance => {
      let row = result.get(id);
      if (!row) {
        row = emptyPerformance();
        result.set(id, row);
      }
      return row;
    };
    const createdBetween = {
      gte: new Date(`${range.from}T00:00:00.000Z`),
      lt: new Date(Date.parse(`${range.to}T00:00:00.000Z`) + DAY_MS),
    };

    const [aggregates, contacts, bookings, orders] = await Promise.all([
      this.prisma.analyticsAggregate.groupBy({
        by: ["organizationId", "metric"],
        where: { organizationId: { in: organizationIds }, period: { gte: range.from, lte: range.to }, metric: { in: ["page_view", ...CLICK_METRICS] } },
        _sum: { value: true },
      }),
      this.prisma.contact.groupBy({ by: ["organizationId"], where: { organizationId: { in: organizationIds }, createdAt: createdBetween }, _count: { _all: true } }),
      this.prisma.booking.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: organizationIds }, createdAt: createdBetween, status: { not: BookingStatus.CANCELLED } },
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ["organizationId"],
        where: { organizationId: { in: organizationIds }, createdAt: createdBetween, status: { not: OrderStatus.CANCELLED } },
        _count: { _all: true },
      }),
    ]);

    for (const row of aggregates) {
      const value = row._sum.value ?? 0;
      if (row.metric === "page_view") at(row.organizationId).pageViews += value;
      else at(row.organizationId).clicks += value;
    }
    for (const row of contacts) at(row.organizationId).newContacts = row._count._all;
    for (const row of bookings) at(row.organizationId).bookings = row._count._all;
    for (const row of orders) at(row.organizationId).orders = row._count._all;
    // Un cliente sin actividad también devuelve ceros (no «sin dato»).
    for (const id of organizationIds) at(id);
    return result;
  }

  /** Plan y cupo, dominios, última publicación y alertas por organización (7 consultas, sin importar cuántas). */
  private async healthFor(organizationIds: string[]): Promise<Map<string, ClientHealth>> {
    const result = new Map<string, ClientHealth>();
    if (organizationIds.length === 0) return result;

    const [effectivePlans, sites, contacts, domains, published, organizations] = await Promise.all([
      this.plans.resolveEffectivePlans(organizationIds),
      this.prisma.site.groupBy({ by: ["organizationId"], where: { organizationId: { in: organizationIds }, status: { not: SiteStatus.ARCHIVED } }, _count: { _all: true } }),
      this.prisma.contact.groupBy({ by: ["organizationId"], where: { organizationId: { in: organizationIds } }, _count: { _all: true } }),
      this.prisma.siteDomain.groupBy({ by: ["organizationId", "verificationStatus"], where: { organizationId: { in: organizationIds } }, _count: { _all: true } }),
      this.prisma.$queryRaw<Array<{ organization_id: string; last_published_at: Date }>>`
        SELECT s.organization_id, MAX(v.published_at) AS last_published_at
        FROM page_versions v
        JOIN pages p ON p.id = v.page_id
        JOIN sites s ON s.id = p.site_id
        WHERE s.organization_id = ANY(${organizationIds}::uuid[]) AND v.published_at IS NOT NULL
        GROUP BY s.organization_id`,
      this.prisma.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, publicHiddenAt: true } }),
    ]);

    const siteCount = new Map(sites.map((row) => [row.organizationId, row._count._all]));
    const contactCount = new Map(contacts.map((row) => [row.organizationId, row._count._all]));
    const lastPublished = new Map(published.map((row) => [row.organization_id, row.last_published_at]));
    const hidden = new Map(organizations.map((row) => [row.id, row.publicHiddenAt !== null]));
    const domainCounts = new Map<string, { verified: number; pending: number; failed: number }>();
    for (const row of domains) {
      const entry = domainCounts.get(row.organizationId) ?? { verified: 0, pending: 0, failed: 0 };
      if (row.verificationStatus === DomainVerificationStatus.VERIFIED) entry.verified += row._count._all;
      else if (row.verificationStatus === DomainVerificationStatus.FAILED) entry.failed += row._count._all;
      else entry.pending += row._count._all;
      domainCounts.set(row.organizationId, entry);
    }

    for (const id of organizationIds) {
      const effective = effectivePlans.get(id);
      if (!effective) continue;
      const usedSites = siteCount.get(id) ?? 0;
      const usedContacts = contactCount.get(id) ?? 0;
      const { limits } = effective.plan;
      const usage = [
        { key: "sites" as const, label: "Sitios", used: usedSites, limit: limits.sites },
        { key: "contacts" as const, label: "Contactos", used: usedContacts, limit: limits.contacts },
      ];
      const nearLimits = usage.filter((row) => isNearLimit(row.used, row.limit)).map((row) => row.label.toLowerCase());
      const domainState = domainCounts.get(id) ?? { verified: 0, pending: 0, failed: 0 };
      const lastPublishedAt = lastPublished.get(id) ?? null;
      const publicHidden = hidden.get(id) ?? false;
      result.set(id, {
        plan: { code: effective.plan.code, name: effective.plan.name, usage },
        domains: domainState,
        lastPublishedAt,
        siteCount: usedSites,
        publicHidden,
        nearLimit: nearLimits.length > 0,
        alerts: buildClientAlerts({
          domainsFailed: domainState.failed,
          domainsPending: domainState.pending,
          nearLimits,
          publicHidden,
          lastPublishedAt,
          siteCount: usedSites,
        }),
      });
    }
    return result;
  }
}
