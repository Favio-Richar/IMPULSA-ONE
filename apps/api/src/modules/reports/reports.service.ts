import { Inject, Injectable } from "@nestjs/common";
import type { ReportResponse } from "@impulza/contracts";
import { OrderStatus, type PrismaClient } from "@impulza/database";
import {
  compareTotals,
  conversionRate,
  previousPeriod,
  reportCsv,
  sameWindowLastYear,
  type ReportPeriod,
  type ReportQuery,
  type ReportTotals,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AnalyticsReportsService } from "../analytics/analytics-reports.service.js";
import { PlanLimitExceededException } from "../plans/plan-limit.exception.js";

const DAY_MS = 86_400_000;

function bounds(period: ReportPeriod): { gte: Date; lt: Date } {
  return { gte: new Date(`${period.from}T00:00:00.000Z`), lt: new Date(Date.parse(`${period.to}T00:00:00.000Z`) + DAY_MS) };
}

interface PeriodData {
  totals: ReportTotals;
  overview: Awaited<ReturnType<AnalyticsReportsService["overview"]>>;
  currency: string | null;
}

/**
 * Informe por cliente (F9.8, ADR-028 §6). Los datos salen **solo** de la organización de la ruta (verificada por la puerta de entrada) y son
 * cifras agregadas: ningún dato personal de contactos. La comparación contra el periodo anterior y el del año anterior respeta el historial
 * del plan (los datos más viejos no se muestran, ADR-004): una comparación fuera de él se informa como no disponible, no se calcula.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly analytics: AnalyticsReportsService,
  ) {}

  /** Todo lo que cuenta un periodo: analítica agregada + reservas, pedidos y ventas de la organización. */
  private async collect(organizationId: string, period: ReportPeriod): Promise<PeriodData> {
    const overview = await this.analytics.overview(organizationId, { from: period.from, to: period.to }, { skipHistoryLimit: true });
    const window = bounds(period);
    const [bookings, orders, paid] = await Promise.all([
      this.prisma.booking.count({ where: { organizationId, createdAt: window, status: { not: "CANCELLED" } } }),
      this.prisma.order.count({ where: { organizationId, createdAt: window, status: { not: OrderStatus.CANCELLED } } }),
      this.prisma.order.groupBy({
        by: ["priceCurrency"],
        where: { organizationId, paidAt: window, status: { in: [OrderStatus.PAID, OrderStatus.DELIVERED] } },
        _sum: { totalAmount: true },
      }),
    ]);
    // Una sola moneda en el informe: la de mayor venta (sumar monedas distintas no tiene sentido).
    const main = [...paid].sort((a, b) => (b._sum.totalAmount ?? 0) - (a._sum.totalAmount ?? 0))[0];
    return {
      overview,
      currency: main?.priceCurrency ?? null,
      totals: {
        pageViews: overview.totals.pageViews,
        visitors: overview.totals.visitors,
        blockClicks: overview.totals.blockClicks,
        whatsappClicks: overview.totals.whatsappClicks,
        leads: overview.totals.leads,
        newContacts: overview.totals.newContacts,
        bookings,
        orders,
        revenue: main?._sum.totalAmount ?? 0,
      },
    };
  }

  /** ¿El historial del plan llega hasta el inicio de este periodo? */
  private async withinHistory(organizationId: string, period: ReportPeriod): Promise<boolean> {
    try {
      await this.analytics.assertWithinHistoryLimit(organizationId, period.from);
      return true;
    } catch (error) {
      if (error instanceof PlanLimitExceededException) return false;
      throw error;
    }
  }

  /** El periodo pedido debe caber en el historial del plan (402 si no): lo usa también la creación de un enlace compartido. */
  async assertPeriodAllowed(organizationId: string, from: string): Promise<void> {
    await this.analytics.assertWithinHistoryLimit(organizationId, from);
  }

  async build(organizationId: string, query: ReportQuery): Promise<ReportResponse> {
    const period: ReportPeriod = { from: query.from, to: query.to };
    // El periodo pedido sí obedece al historial del plan (402 si se pasa), como el resto de la analítica.
    await this.analytics.assertWithinHistoryLimit(organizationId, period.from);

    const previous = previousPeriod(period);
    const lastYear = sameWindowLastYear(period);
    const [organization, current, previousData, lastYearData] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
      this.collect(organizationId, period),
      (await this.withinHistory(organizationId, previous)) ? this.collect(organizationId, previous) : Promise.resolve(null),
      (await this.withinHistory(organizationId, lastYear)) ? this.collect(organizationId, lastYear) : Promise.resolve(null),
    ]);

    return {
      organizationName: organization.name,
      period,
      previousPeriod: previous,
      lastYearPeriod: lastYear,
      comparison: { previousAvailable: previousData !== null, lastYearAvailable: lastYearData !== null },
      metrics: compareTotals(current.totals, previousData?.totals ?? null, lastYearData?.totals ?? null),
      conversion: {
        value: conversionRate(current.totals),
        previous: previousData ? conversionRate(previousData.totals) : null,
        lastYear: lastYearData ? conversionRate(lastYearData.totals) : null,
      },
      currency: current.currency,
      series: current.overview.series,
      topBlocks: current.overview.topBlocks,
      topPages: current.overview.topPages,
      generatedAt: new Date().toISOString(),
    };
  }

  /** El mismo informe como CSV (con las celdas neutralizadas). */
  async buildCsv(organizationId: string, query: ReportQuery): Promise<string> {
    const report = await this.build(organizationId, query);
    return reportCsv({
      organizationName: report.organizationName,
      period: report.period,
      previousPeriod: report.previousPeriod,
      lastYearPeriod: report.lastYearPeriod,
      metrics: report.metrics,
      conversion: report.conversion,
      topBlocks: report.topBlocks.map((block) => ({ label: block.label ?? block.kind ?? "Bloque eliminado", detail: block.detail, value: block.value })),
    });
  }
}
