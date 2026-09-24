import { Inject, Injectable, InternalServerErrorException } from "@nestjs/common";
import type { OrganizationPlanResponse, PlanResponse, PlanUsageResponse } from "@impulza/contracts";
import { MembershipStatus, type Plan, type Prisma, type PrismaClient, SiteStatus, SubscriptionStatus } from "@impulza/database";
import { DEFAULT_PLAN_CODE, type EnforcedLimitKey, planLimitsSchema } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { PlanLimitExceededException } from "./plan-limit.exception.js";

/** Cualquier cliente que sirva para leer: el normal o el de una transacción en curso (F4.2 cuenta
 *  el uso dentro de la misma transacción que crea el recurso). */
type Db = PrismaClient | Prisma.TransactionClient;

/** Estados que dan derecho al plan de la suscripción mientras dure su período. `PAST_DUE` incluido
 *  a propósito: es el período de gracia (la política exacta de morosidad es de F4.6). */
const ENTITLED_STATUSES = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE];

export interface EffectivePlan {
  plan: PlanResponse;
  source: OrganizationPlanResponse["source"];
}

/**
 * Planes y uso (F4.1). **Único** lugar del servidor que decide el plan efectivo de una
 * organización — nunca se confía en un plan que mande el cliente:
 *
 * 1. una suscripción vigente con derecho (activa, en prueba o morosa dentro de su período);
 * 2. si no, el plan asignado a mano por superadministración (`Organization.planId`, F4.4);
 * 3. si no, el plan por defecto (Gratis). Así toda organización existente tiene plan sin tener que
 *    reescribir sus filas.
 */
@Injectable()
export class PlansService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** `limits` es una columna JSON: se valida contra el esquema en cada lectura. Un plan con
   *  límites inválidos es un error de configuración de la plataforma, no algo que se deba
   *  "adivinar" — se registra y se responde 500. */
  toPlanResponse(plan: Plan): PlanResponse {
    const limits = planLimitsSchema.safeParse(plan.limits);
    if (!limits.success) {
      logger.error("plan con límites inválidos en la base", { planCode: plan.code, issues: limits.error.issues });
      throw new InternalServerErrorException("Configuración de planes inválida.");
    }
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      currency: plan.currency,
      sortOrder: plan.sortOrder,
      limits: limits.data,
    };
  }

  async listCatalog(): Promise<PlanResponse[]> {
    const plans = await this.prisma.plan.findMany({ orderBy: { sortOrder: "asc" } });
    return plans.map((plan) => this.toPlanResponse(plan));
  }

  async resolveEffectivePlan(organizationId: string, db: Db = this.prisma): Promise<EffectivePlan> {
    const subscription = await db.subscription.findFirst({
      where: { organizationId, status: { in: ENTITLED_STATUSES }, currentPeriodEnd: { gte: new Date() } },
      orderBy: { currentPeriodEnd: "desc" },
      include: { plan: true },
    });
    if (subscription) {
      return { plan: this.toPlanResponse(subscription.plan), source: "subscription" };
    }

    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      include: { plan: true },
    });
    if (organization?.plan) {
      return { plan: this.toPlanResponse(organization.plan), source: "assigned" };
    }

    const defaultPlan = await db.plan.findUnique({ where: { code: DEFAULT_PLAN_CODE } });
    if (!defaultPlan) {
      logger.error("falta el plan por defecto en el catálogo (¿se corrió el seed?)", { code: DEFAULT_PLAN_CODE });
      throw new InternalServerErrorException("Configuración de planes incompleta.");
    }
    return { plan: this.toPlanResponse(defaultPlan), source: "default" };
  }

  /**
   * Uso actual contra cada límite de nivel organización. Los sitios archivados no cuentan (archivar
   * libera el cupo); los miembros incluyen invitaciones pendientes (ocupan un lugar hasta que se
   * aceptan o se revocan).
   */
  async usage(organizationId: string, db: Db = this.prisma): Promise<PlanUsageResponse> {
    const [sites, forms, contacts, shortLinks, qrCodes, members] = await Promise.all([
      db.site.count({ where: { organizationId, status: { not: SiteStatus.ARCHIVED } } }),
      db.form.count({ where: { site: { organizationId } } }),
      db.contact.count({ where: { organizationId } }),
      db.shortLink.count({ where: { organizationId } }),
      db.qrCode.count({ where: { organizationId } }),
      db.membership.count({
        where: { organizationId, status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] } },
      }),
    ]);
    return { sites, forms, contacts, shortLinks, qrCodes, members };
  }

  /** Conteo de un solo límite (el mismo criterio que `usage`), para no contar todo en cada alta. */
  private async countFor(key: EnforcedLimitKey, organizationId: string, db: Db): Promise<number> {
    switch (key) {
      case "sites":
        return db.site.count({ where: { organizationId, status: { not: SiteStatus.ARCHIVED } } });
      case "forms":
        return db.form.count({ where: { site: { organizationId } } });
      case "contacts":
        return db.contact.count({ where: { organizationId } });
      case "shortLinks":
        return db.shortLink.count({ where: { organizationId } });
      case "qrCodes":
        return db.qrCode.count({ where: { organizationId } });
      case "members":
        return db.membership.count({
          where: { organizationId, status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] } },
        });
    }
  }

  /**
   * Verifica un límite antes de crear (F4.2). **Tiene que llamarse dentro de la misma transacción
   * que crea el recurso**: toma un lock consultivo por organización y tipo de límite, así dos altas
   * simultáneas se serializan — la segunda cuenta después de que la primera ya creó — y ninguna
   * puede pasar el límite. El lock se libera solo al terminar la transacción.
   *
   * `pagesPerSite` se cuenta por sitio (`siteId` obligatorio); el resto, por organización.
   */
  async assertWithinLimit(
    tx: Prisma.TransactionClient,
    organizationId: string,
    key: EnforcedLimitKey | "pagesPerSite",
    siteId?: string,
  ): Promise<void> {
    const lockKey = key === "pagesPerSite" ? `plan-limit:${organizationId}:pages:${siteId}` : `plan-limit:${organizationId}:${key}`;
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS acquired`;

    const { plan } = await this.resolveEffectivePlan(organizationId, tx);
    const max = plan.limits[key];
    if (max === null) {
      return;
    }

    const used =
      key === "pagesPerSite"
        ? await tx.page.count({ where: { siteId, deletedAt: null } })
        : await this.countFor(key, organizationId, tx);

    if (used >= max) {
      throw new PlanLimitExceededException(key, max, used, { code: plan.code, name: plan.name });
    }
  }

  async organizationPlan(organizationId: string): Promise<OrganizationPlanResponse> {
    const [effective, usage] = await Promise.all([
      this.resolveEffectivePlan(organizationId),
      this.usage(organizationId),
    ]);
    return { ...effective, usage };
  }
}
