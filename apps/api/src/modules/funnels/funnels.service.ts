import { HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { FunnelReportResponse, FunnelResponse, FunnelStepResponse } from "@impulza/contracts";
import { Prisma, type Funnel, type PrismaClient } from "@impulza/database";
import {
  FUNNEL_MAX_PER_SITE,
  funnelStepsSchema,
  type CreateFunnelInput,
  type FunnelReportQuery,
  type FunnelStep,
  type UpdateFunnelInput,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { blockOwnLabel, AnalyticsReportsService } from "../analytics/analytics-reports.service.js";
import { AuditService } from "../audit/audit.service.js";

export const FUNNEL_LIMIT_REACHED = "FUNNEL_LIMIT_REACHED";
export const FUNNEL_SUBJECT_INVALID = "FUNNEL_SUBJECT_INVALID";

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

/** Fracción redondeada a 4 decimales, o `null` si el denominador es 0. */
function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

/** Nombre de una tabla temporal del CTE: siempre generado acá a partir de un índice, nunca de una entrada. */
function cte(index: number): Prisma.Sql {
  return Prisma.raw(`s${index}`);
}

/**
 * Embudos de conversión (F7.6, ADR-021). La definición vive en `funnels`; el informe se calcula al
 * consultar sobre `analytics_events`, siempre acotado al sitio ya verificado en la organización de
 * la ruta (ADR-002). Solo devuelve totales por paso, nunca filas por visita (ADR-004).
 */
@Injectable()
export class FunnelsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly reports: AnalyticsReportsService,
  ) {}

  private async assertSite(organizationId: string, siteId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId }, select: { id: true } });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
  }

  private async getOrThrow(organizationId: string, siteId: string, funnelId: string): Promise<Funnel> {
    const funnel = await this.prisma.funnel.findFirst({ where: { id: funnelId, organizationId, siteId } });
    if (!funnel) {
      throw new NotFoundException("Embudo no encontrado.");
    }
    return funnel;
  }

  /**
   * Los pasos guardados se revalidan al leer: una columna JSON no se cree a ciegas. Un embudo que
   * dejó de cumplir el esquema (un evento retirado del catálogo) es un error de datos de la
   * plataforma: se registra y se responde 500, nunca se calcula a medias.
   */
  private parseSteps(funnel: Funnel): FunnelStep[] {
    const parsed = funnelStepsSchema.safeParse(funnel.steps);
    if (!parsed.success) {
      logger.error("embudo con pasos inválidos en la base", { funnelId: funnel.id, issues: parsed.error.issues });
      throw new Error("Embudo con pasos inválidos.");
    }
    return parsed.data;
  }

  /**
   * Cada página o bloque de un paso tiene que ser de **este** sitio (página no borrada; bloque de
   * una página no borrada). Sin esto, alguien podría apuntar un paso a la página de otro sitio u
   * otra organización y, por el conteo, deducir algo de ella.
   */
  private async assertSubjects(organizationId: string, siteId: string, steps: FunnelStep[]): Promise<void> {
    for (const [index, step] of steps.entries()) {
      if (step.subjectId === null) {
        continue;
      }
      const exists =
        step.events[0] === "page_view"
          ? await this.prisma.page.findFirst({ where: { id: step.subjectId, siteId, deletedAt: null, site: { organizationId } }, select: { id: true } })
          : await this.prisma.block.findFirst({
              where: { id: step.subjectId, page: { siteId, deletedAt: null, site: { organizationId } } },
              select: { id: true },
            });
      if (!exists) {
        throw unprocessable(
          FUNNEL_SUBJECT_INVALID,
          step.events[0] === "page_view" ? "Esa página no es de este sitio." : "Ese bloque no es de este sitio.",
          `steps.${index}.subjectId`,
        );
      }
    }
  }

  /** Nombres legibles de las páginas y bloques de los pasos (una consulta por tipo, acotada al sitio). */
  private async subjectLabels(siteId: string, steps: FunnelStep[]): Promise<Map<string, string>> {
    const pageIds = steps.filter((step) => step.subjectId && step.events[0] === "page_view").map((step) => step.subjectId!);
    const blockIds = steps.filter((step) => step.subjectId && step.events[0] === "block_click").map((step) => step.subjectId!);
    const labels = new Map<string, string>();
    if (pageIds.length > 0) {
      const pages = await this.prisma.page.findMany({ where: { id: { in: pageIds }, siteId }, select: { id: true, slug: true, isHome: true } });
      for (const page of pages) {
        labels.set(page.id, page.isHome ? "Inicio" : `/${page.slug}`);
      }
    }
    if (blockIds.length > 0) {
      const blocks = await this.prisma.block.findMany({
        where: { id: { in: blockIds }, page: { siteId } },
        select: { id: true, type: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { config: true } } },
      });
      for (const block of blocks) {
        labels.set(block.id, blockOwnLabel(block.versions[0]?.config) ?? `Bloque ${block.type}`);
      }
    }
    return labels;
  }

  private async toResponse(funnel: Funnel): Promise<FunnelResponse> {
    const steps = this.parseSteps(funnel);
    const labels = await this.subjectLabels(funnel.siteId, steps);
    return {
      id: funnel.id,
      siteId: funnel.siteId,
      name: funnel.name,
      steps: steps.map(
        (step): FunnelStepResponse => ({
          label: step.label,
          events: step.events,
          subjectId: step.subjectId,
          subjectLabel: step.subjectId ? (labels.get(step.subjectId) ?? null) : null,
        }),
      ),
      createdAt: funnel.createdAt.toISOString(),
      updatedAt: funnel.updatedAt.toISOString(),
    };
  }

  async list(organizationId: string, siteId: string): Promise<FunnelResponse[]> {
    await this.assertSite(organizationId, siteId);
    const funnels = await this.prisma.funnel.findMany({ where: { organizationId, siteId }, orderBy: { createdAt: "asc" } });
    return Promise.all(funnels.map((funnel) => this.toResponse(funnel)));
  }

  async get(organizationId: string, siteId: string, funnelId: string): Promise<FunnelResponse> {
    return this.toResponse(await this.getOrThrow(organizationId, siteId, funnelId));
  }

  async create(organizationId: string, actorId: string, siteId: string, input: CreateFunnelInput): Promise<FunnelResponse> {
    await this.assertSite(organizationId, siteId);
    await this.assertSubjects(organizationId, siteId, input.steps);

    // El tope es por sitio y se comprueba dentro de la transacción que crea, con un bloqueo por
    // sitio: dos altas simultáneas no pueden dejar 11 embudos.
    const funnel = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`funnels:${siteId}`}, 0))`;
      const count = await tx.funnel.count({ where: { siteId } });
      if (count >= FUNNEL_MAX_PER_SITE) {
        throw unprocessable(FUNNEL_LIMIT_REACHED, `Un sitio puede tener hasta ${FUNNEL_MAX_PER_SITE} embudos. Borra uno para crear otro.`);
      }
      return tx.funnel.create({
        data: { organizationId, siteId, name: input.name, steps: input.steps as unknown as Prisma.InputJsonValue },
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "funnel.created",
      targetType: "Funnel",
      targetId: funnel.id,
      metadata: { siteId, name: funnel.name, steps: input.steps.length },
    });
    return this.toResponse(funnel);
  }

  async update(organizationId: string, actorId: string, siteId: string, funnelId: string, input: UpdateFunnelInput): Promise<FunnelResponse> {
    const funnel = await this.getOrThrow(organizationId, siteId, funnelId);
    if (input.steps) {
      await this.assertSubjects(organizationId, siteId, input.steps);
    }
    const updated = await this.prisma.funnel.update({
      where: { id: funnel.id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.steps === undefined ? {} : { steps: input.steps as unknown as Prisma.InputJsonValue }),
      },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "funnel.updated",
      targetType: "Funnel",
      targetId: funnel.id,
      metadata: { siteId, nameChanged: input.name !== undefined, stepsChanged: input.steps !== undefined },
    });
    return this.toResponse(updated);
  }

  async remove(organizationId: string, actorId: string, siteId: string, funnelId: string): Promise<void> {
    const funnel = await this.getOrThrow(organizationId, siteId, funnelId);
    await this.prisma.funnel.delete({ where: { id: funnel.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "funnel.deleted",
      targetType: "Funnel",
      targetId: funnel.id,
      metadata: { siteId, name: funnel.name },
    });
  }

  /**
   * Filas candidatas de un paso: `(v, t, device)` = visita del día, instante y dispositivo. Los
   * eventos salen del sitio y del rango; el pago, del cruce del pedido o la reserva creados en el
   * rango con su pago (cuando sea que llegó, ADR-021 §4), por la clave de idempotencia del evento.
   */
  private stepSource(siteId: string, step: FunnelStep, from: Date, to: Date): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    const events = step.events.filter((event) => event !== "payment");
    if (events.length > 0) {
      parts.push(Prisma.sql`
        SELECT e.anonymized_visitor_id AS v, e.created_at AS t, e.device AS device
        FROM analytics_events e
        WHERE e.site_id = ${siteId}::uuid AND e.type IN (${Prisma.join(events)})
          AND e.created_at >= ${from} AND e.created_at < ${to}
          AND e.anonymized_visitor_id IS NOT NULL
          ${step.subjectId ? Prisma.sql`AND e.subject_id = ${step.subjectId}` : Prisma.empty}`);
    }
    if (step.events.includes("payment")) {
      parts.push(Prisma.sql`
        SELECT e.anonymized_visitor_id AS v, o.paid_at AS t, e.device AS device
        FROM analytics_events e
        JOIN orders o ON e.idempotency_key = 'order_created:' || o.id::text AND o.site_id = e.site_id
        WHERE e.site_id = ${siteId}::uuid AND e.type = 'order_created'
          AND e.created_at >= ${from} AND e.created_at < ${to}
          AND e.anonymized_visitor_id IS NOT NULL AND o.paid_at IS NOT NULL`);
      parts.push(Prisma.sql`
        SELECT e.anonymized_visitor_id AS v, b.deposit_paid_at AS t, e.device AS device
        FROM analytics_events e
        JOIN bookings b ON e.idempotency_key = 'booking_created:' || b.id::text AND b.site_id = e.site_id
        WHERE e.site_id = ${siteId}::uuid AND e.type = 'booking_created'
          AND e.created_at >= ${from} AND e.created_at < ${to}
          AND e.anonymized_visitor_id IS NOT NULL AND b.deposit_paid_at IS NOT NULL`);
    }
    return Prisma.join(parts, " UNION ALL ");
  }

  async report(organizationId: string, siteId: string, funnelId: string, query: FunnelReportQuery): Promise<FunnelReportResponse> {
    await this.reports.assertWithinHistoryLimit(organizationId, query.from);
    const funnel = await this.getOrThrow(organizationId, siteId, funnelId);
    const steps = this.parseSteps(funnel);
    const from = new Date(`${query.from}T00:00:00.000Z`);
    const to = new Date(Date.parse(`${query.to}T00:00:00.000Z`) + DAY_MS);

    // Un CTE por paso: el primero toma la primera vez que cada visita hizo el paso (opcionalmente
    // desde un dispositivo); cada siguiente, la primera vez **en o después** del paso anterior de
    // esa misma visita. Así cuenta solo a quien avanzó en orden.
    const ctes = steps.map((step, index) => {
      const source = this.stepSource(siteId, step, from, to);
      if (index === 0) {
        return Prisma.sql`${cte(0)} AS (
          SELECT x.v, MIN(x.t) AS t FROM (${source}) x
          ${query.device ? Prisma.sql`WHERE x.device = ${query.device}` : Prisma.empty}
          GROUP BY x.v)`;
      }
      return Prisma.sql`${cte(index)} AS (
        SELECT x.v, MIN(x.t) AS t FROM (${source}) x
        JOIN ${cte(index - 1)} p ON p.v = x.v AND x.t >= p.t
        GROUP BY x.v)`;
    });
    const totals = steps.map((_, index) =>
      index === 0
        ? Prisma.sql`SELECT 0 AS idx, COUNT(*)::int AS visitors, NULL::float8 AS median FROM ${cte(0)}`
        : Prisma.sql`SELECT ${index}::int AS idx, COUNT(*)::int AS visitors,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (c.t - p.t)))::float8 AS median
          FROM ${cte(index)} c JOIN ${cte(index - 1)} p ON p.v = c.v`,
    );

    const startedAt = performance.now();
    const rows = await this.prisma.$queryRaw<Array<{ idx: number; visitors: number; median: number | null }>>`
      WITH ${Prisma.join(ctes, ", ")}
      ${Prisma.join(totals, " UNION ALL ")}
      ORDER BY idx`;
    const durationMs = Math.round(performance.now() - startedAt);
    logger.info("embudo calculado", { organizationId, siteId, funnelId, steps: steps.length, durationMs });

    const visitorsAt = steps.map((_, index) => rows.find((row) => Number(row.idx) === index)?.visitors ?? 0);
    const first = visitorsAt[0] ?? 0;
    const reportSteps = steps.map((step, index) => {
      const visitors = visitorsAt[index] ?? 0;
      const previous = index === 0 ? null : (visitorsAt[index - 1] ?? 0);
      const median = rows.find((row) => Number(row.idx) === index)?.median ?? null;
      return {
        label: step.label,
        visitors,
        conversionFromPrevious: previous === null ? null : ratio(visitors, previous),
        conversionFromStart: index === 0 ? null : ratio(visitors, first),
        dropOff: previous === null ? 0 : previous - visitors,
        dropOffRate: previous === null ? null : ratio(previous - visitors, previous),
        medianSecondsFromPrevious: median === null ? null : Math.round(median),
      };
    });

    let biggestDropOffStep: number | null = null;
    for (const [index, step] of reportSteps.entries()) {
      if (step.dropOff > 0 && (biggestDropOffStep === null || step.dropOff > reportSteps[biggestDropOffStep]!.dropOff)) {
        biggestDropOffStep = index;
      }
    }

    return {
      funnelId: funnel.id,
      from: query.from,
      to: query.to,
      device: query.device ?? null,
      steps: reportSteps,
      overallConversion: ratio(visitorsAt.at(-1) ?? 0, first),
      biggestDropOffStep,
    };
  }
}
