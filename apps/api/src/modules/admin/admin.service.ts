import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AdminAuditListResponse,
  AdminOrganizationDetailResponse,
  AdminOrganizationListResponse,
  AdminOverviewResponse,
  AdminUserListResponse,
  PlanResponse,
} from "@impulza/contracts";
import { MembershipStatus, OrganizationStatus, type Prisma, type PrismaClient, SiteStatus } from "@impulza/database";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { PlansService } from "../plans/plans.service.js";
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";
import type { ListAdminAuditQueryDto, ListAdminOrganizationsQueryDto, ListAdminUsersQueryDto } from "./dto/admin-queries.dto.js";
import type { UpdatePlanDto } from "./dto/admin-actions.dto.js";

const ORGANIZATION_NOT_FOUND = "Organización no encontrada.";
const SIGNUP_WINDOW_DAYS = 30;

/** Un sitio "publicado" es uno que de verdad se sirve: no archivado y con al menos una página
 *  publicada. `Site.status` no sirve para esto — publicar una página no lo cambia. */
const PUBLISHED_SITE_WHERE: Prisma.SiteWhereInput = {
  status: { not: SiteStatus.ARCHIVED },
  pages: { some: { status: "PUBLISHED", deletedAt: null } },
};

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Superadministración de la plataforma (F4.4, ADR-005). Cada método que **cambia** algo o que abre
 * el detalle de una organización deja una fila de auditoría con el superadministrador como actor.
 * Nada de acá lee contactos, envíos, contenido de páginas ni analítica de visitantes (ADR-005 §5).
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PlansService) private readonly plansService: PlansService,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(RevalidateWebService) private readonly revalidateWeb: RevalidateWebService,
  ) {}

  async overview(): Promise<AdminOverviewResponse> {
    const since = new Date(Date.now() - (SIGNUP_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
    since.setUTCHours(0, 0, 0, 0);

    const [users, organizations, blockedOrganizations, publishedSites, userSignups, orgSignups, recent, allOrganizationIds] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.organization.count(),
        this.prisma.organization.count({ where: { status: OrganizationStatus.BLOCKED } }),
        this.prisma.site.count({ where: PUBLISHED_SITE_WHERE }),
        this.prisma.$queryRaw<Array<{ day: string; n: number }>>`
          SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS n
          FROM users WHERE created_at >= ${since} GROUP BY 1`,
        this.prisma.$queryRaw<Array<{ day: string; n: number }>>`
          SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS n
          FROM organizations WHERE created_at >= ${since} GROUP BY 1`,
        this.prisma.organization.findMany({
          orderBy: { createdAt: "desc" },
          take: 8,
          select: { id: true, name: true, slug: true, status: true, createdAt: true },
        }),
        this.prisma.organization.findMany({ select: { id: true } }),
      ]);

    const usersByDay = new Map(userSignups.map((row) => [row.day, row.n]));
    const orgsByDay = new Map(orgSignups.map((row) => [row.day, row.n]));
    const signups = Array.from({ length: SIGNUP_WINDOW_DAYS }, (_, index) => {
      const day = dayKey(new Date(since.getTime() + index * 24 * 60 * 60 * 1000));
      return { day, users: usersByDay.get(day) ?? 0, organizations: orgsByDay.get(day) ?? 0 };
    });

    // Distribución por plan **efectivo** (suscripción → asignado → Gratis), no por `planId`: una
    // organización sin asignación manual también tiene plan.
    const effective = await this.plansService.resolveEffectivePlans(allOrganizationIds.map((org) => org.id));
    const byPlan = new Map<string, { planCode: string; planName: string; organizations: number; sortOrder: number }>();
    for (const { plan } of effective.values()) {
      const entry = byPlan.get(plan.code) ?? { planCode: plan.code, planName: plan.name, organizations: 0, sortOrder: plan.sortOrder };
      entry.organizations += 1;
      byPlan.set(plan.code, entry);
    }
    const catalog = await this.plansService.listCatalog();
    const planDistribution = catalog.map((plan) => ({
      planCode: plan.code,
      planName: plan.name,
      organizations: byPlan.get(plan.code)?.organizations ?? 0,
    }));

    return {
      totals: { users, organizations, blockedOrganizations, publishedSites },
      signups,
      planDistribution,
      recentOrganizations: recent.map((org) => ({ ...org, createdAt: org.createdAt.toISOString() })),
    };
  }

  async listOrganizations(query: ListAdminOrganizationsQueryDto): Promise<AdminOrganizationListResponse> {
    const where: Prisma.OrganizationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
              // Buscar por el correo de un miembro: "el cliente fulano@... no puede entrar".
              { memberships: { some: { user: { email: { contains: query.search, mode: "insensitive" } } } } },
            ],
          }
        : {}),
    };

    const [total, organizations] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          _count: {
            select: {
              memberships: { where: { status: MembershipStatus.ACTIVE } },
              sites: { where: { status: { not: SiteStatus.ARCHIVED } } },
            },
          },
        },
      }),
    ]);

    const plans = await this.plansService.resolveEffectivePlans(organizations.map((org) => org.id));

    return {
      total,
      items: organizations.map((org) => {
        const plan = plans.get(org.id)!.plan;
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          status: org.status,
          planCode: plan.code,
          planName: plan.name,
          members: org._count.memberships,
          sites: org._count.sites,
          createdAt: org.createdAt.toISOString(),
        };
      }),
    };
  }

  private async getOrganizationOrThrow(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException(ORGANIZATION_NOT_FOUND);
    }
    return organization;
  }

  private async buildOrganizationDetail(organizationId: string): Promise<AdminOrganizationDetailResponse> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        memberships: {
          where: { status: { not: MembershipStatus.REMOVED } },
          orderBy: { invitedAt: "asc" },
          include: { user: { select: { email: true } }, role: { select: { name: true } } },
        },
        sites: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            _count: { select: { pages: { where: { status: "PUBLISHED", deletedAt: null } } } },
          },
        },
      },
    });
    if (!organization) {
      throw new NotFoundException(ORGANIZATION_NOT_FOUND);
    }

    const plan = await this.plansService.organizationPlan(organizationId);

    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      blockedAt: organization.blockedAt?.toISOString() ?? null,
      blockedReason: organization.blockedReason,
      createdAt: organization.createdAt.toISOString(),
      plan: plan.plan,
      planSource: plan.source,
      usage: plan.usage,
      members: organization.memberships.map((membership) => ({
        membershipId: membership.id,
        email: membership.user.email,
        role: membership.role.name,
        status: membership.status,
      })),
      sites: organization.sites.map(({ _count, ...site }) => ({
        ...site,
        live: site.status !== SiteStatus.ARCHIVED && _count.pages > 0,
      })),
    };
  }

  /** Abrir el detalle queda auditado: nada de acceso silencioso a una organización (ADR-005 §5). */
  async getOrganization(adminId: string, organizationId: string): Promise<AdminOrganizationDetailResponse> {
    const detail = await this.buildOrganizationDetail(organizationId);
    await this.auditService.record({
      organizationId,
      actorId: adminId,
      action: "admin.organization_viewed",
      targetType: "Organization",
      targetId: organizationId,
    });
    return detail;
  }

  async changeOrganizationPlan(
    adminId: string,
    organizationId: string,
    planId: string | null,
    reason: string,
  ): Promise<AdminOrganizationDetailResponse> {
    const organization = await this.getOrganizationOrThrow(organizationId);
    const previous = await this.plansService.resolveEffectivePlan(organizationId);

    if (planId !== null) {
      const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
      if (!plan) {
        throw new NotFoundException("Plan no encontrado.");
      }
    }

    await this.prisma.organization.update({ where: { id: organizationId }, data: { planId } });
    const next = await this.plansService.resolveEffectivePlan(organizationId);

    await this.auditService.record({
      organizationId,
      actorId: adminId,
      action: "admin.organization_plan_changed",
      targetType: "Organization",
      targetId: organizationId,
      metadata: {
        reason,
        assignedFrom: organization.planId,
        assignedTo: planId,
        effectiveFrom: previous.plan.code,
        effectiveTo: next.plan.code,
        // Si hay una suscripción vigente, la asignación manual no cambia el plan efectivo todavía.
        effectiveSource: next.source,
      },
    });
    logger.info("superadministración cambió el plan de una organización", {
      organizationId,
      adminId,
      from: previous.plan.code,
      to: next.plan.code,
    });

    return this.buildOrganizationDetail(organizationId);
  }

  async blockOrganization(adminId: string, organizationId: string, reason: string): Promise<AdminOrganizationDetailResponse> {
    const organization = await this.getOrganizationOrThrow(organizationId);
    if (organization.status === OrganizationStatus.BLOCKED) {
      throw new ConflictException("La organización ya está bloqueada.");
    }

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { status: OrganizationStatus.BLOCKED, blockedAt: new Date(), blockedReason: reason },
    });
    await this.auditService.record({
      organizationId,
      actorId: adminId,
      action: "admin.organization_blocked",
      targetType: "Organization",
      targetId: organizationId,
      metadata: { reason },
    });
    logger.warn("organización bloqueada por superadministración", { organizationId, adminId });

    await this.revalidateSites(organizationId);
    return this.buildOrganizationDetail(organizationId);
  }

  async unblockOrganization(adminId: string, organizationId: string, reason: string): Promise<AdminOrganizationDetailResponse> {
    const organization = await this.getOrganizationOrThrow(organizationId);
    if (organization.status !== OrganizationStatus.BLOCKED) {
      throw new ConflictException("La organización no está bloqueada.");
    }

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { status: OrganizationStatus.ACTIVE, blockedAt: null, blockedReason: null },
    });
    await this.auditService.record({
      organizationId,
      actorId: adminId,
      action: "admin.organization_unblocked",
      targetType: "Organization",
      targetId: organizationId,
      metadata: { reason, blockedSince: organization.blockedAt?.toISOString() ?? null },
    });
    logger.info("organización restaurada por superadministración", { organizationId, adminId });

    await this.revalidateSites(organizationId);
    return this.buildOrganizationDetail(organizationId);
  }

  /** El sitio público de `apps/web` está en caché: sin esto, un sitio bloqueado se seguiría viendo
   *  hasta la próxima publicación (y uno restaurado seguiría dando 404). */
  private async revalidateSites(organizationId: string): Promise<void> {
    const sites = await this.prisma.site.findMany({ where: { organizationId }, select: { id: true } });
    await Promise.all(sites.map((site) => this.revalidateWeb.revalidateSite(site.id)));
  }

  async listUsers(query: ListAdminUsersQueryDto): Promise<AdminUserListResponse> {
    const where: Prisma.UserWhereInput = query.search
      ? { email: { contains: query.search, mode: "insensitive" } }
      : {};

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          email: true,
          emailVerifiedAt: true,
          twoFactorEnabled: true,
          isSuperAdmin: true,
          createdAt: true,
          _count: { select: { memberships: { where: { status: MembershipStatus.ACTIVE } } } },
        },
      }),
    ]);

    return {
      total,
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerifiedAt !== null,
        twoFactorEnabled: user.twoFactorEnabled,
        isSuperAdmin: user.isSuperAdmin,
        organizations: user._count.memberships,
        createdAt: user.createdAt.toISOString(),
      })),
    };
  }

  async listPlans(): Promise<PlanResponse[]> {
    return this.plansService.listCatalog();
  }

  /** Editar el catálogo (ADR-005 §7): la tabla es la fuente de verdad. Bajar un límite por debajo
   *  del uso actual se permite — como en F4.2, solo impide crear más, nunca borra nada. */
  async updatePlan(adminId: string, planId: string, body: UpdatePlanDto): Promise<PlanResponse> {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      throw new NotFoundException("Plan no encontrado.");
    }

    const { reason, ...changes } = body;
    const updated = await this.prisma.plan.update({
      where: { id: planId },
      data: {
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.priceMonthly !== undefined ? { priceMonthly: changes.priceMonthly } : {}),
        ...(changes.priceYearly !== undefined ? { priceYearly: changes.priceYearly } : {}),
        ...(changes.currency !== undefined ? { currency: changes.currency } : {}),
        ...(changes.limits !== undefined ? { limits: changes.limits } : {}),
      },
    });

    const before = this.plansService.toPlanResponse(plan);
    const after = this.plansService.toPlanResponse(updated);
    await this.auditService.record({
      actorId: adminId,
      action: "admin.plan_updated",
      targetType: "Plan",
      targetId: planId,
      metadata: {
        reason,
        code: plan.code,
        before: { name: before.name, priceMonthly: before.priceMonthly, priceYearly: before.priceYearly, currency: before.currency, limits: before.limits },
        after: { name: after.name, priceMonthly: after.priceMonthly, priceYearly: after.priceYearly, currency: after.currency, limits: after.limits },
      },
    });
    logger.info("superadministración editó un plan del catálogo", { planCode: plan.code, adminId });

    return after;
  }

  async listAudit(query: ListAdminAuditQueryDto): Promise<AdminAuditListResponse> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.scope === "admin" ? { action: { startsWith: "admin." } } : {}),
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    };

    const [total, entries] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { email: true } }, organization: { select: { name: true } } },
      }),
    ]);

    return {
      total,
      items: entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        actorEmail: entry.actor?.email ?? null,
        organizationId: entry.organizationId,
        organizationName: entry.organization?.name ?? null,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata:
          entry.metadata && typeof entry.metadata === "object" && !Array.isArray(entry.metadata)
            ? (entry.metadata as Record<string, unknown>)
            : null,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }
}
