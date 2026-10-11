import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AnalyticsBreakdownRow,
  AnalyticsOverviewResponse,
  AnalyticsSeriesPoint,
  AnalyticsSubjectRow,
} from "@impulza/contracts";
import type { PrismaClient } from "@impulza/database";
import { PRISMA } from "../../database/prisma.module.js";
import { PlanLimitExceededException } from "../plans/plan-limit.exception.js";
import { PlansService } from "../plans/plans.service.js";
import type { AnalyticsOverviewQuery } from "./dto/analytics-overview.dto.js";

const TOP_N = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_LABELS: Record<string, string> = { mobile: "Móvil", tablet: "Tablet", desktop: "Escritorio" };

/** Suma de cada métrica en todo el rango, más el desglose por día que necesita la serie. */
class MetricTotals {
  private readonly total = new Map<string, number>();
  private readonly byDay = new Map<string, Map<string, number>>();

  add(period: string, metric: string, value: number): void {
    this.total.set(metric, (this.total.get(metric) ?? 0) + value);
    const day = this.byDay.get(period) ?? new Map<string, number>();
    day.set(metric, (day.get(metric) ?? 0) + value);
    this.byDay.set(period, day);
  }

  sum(metric: string): number {
    return this.total.get(metric) ?? 0;
  }

  onDay(period: string, metric: string): number {
    return this.byDay.get(period)?.get(metric) ?? 0;
  }

  /** Todas las métricas `<prefijo><clave>` como `{clave: suma}`. */
  withPrefix(prefix: string): Map<string, number> {
    const result = new Map<string, number>();
    for (const [metric, value] of this.total) {
      if (metric.startsWith(prefix)) {
        const key = metric.slice(prefix.length);
        result.set(key, (result.get(key) ?? 0) + value);
      }
    }
    return result;
  }
}

function topEntries(values: Map<string, number>, limit = TOP_N): Array<[string, number]> {
  return [...values.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function mergeCounts(...maps: Map<string, number>[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const map of maps) {
    for (const [key, value] of map) {
      merged.set(key, (merged.get(key) ?? 0) + value);
    }
  }
  return merged;
}

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00.000Z`); t <= Date.parse(`${to}T00:00:00.000Z`); t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** Texto propio de un bloque para mostrarlo en el ranking: el del botón o el título, si tiene. */
export function blockOwnLabel(config: unknown): string | null {
  if (typeof config !== "object" || config === null) {
    return null;
  }
  const record = config as Record<string, unknown>;
  for (const key of ["label", "title", "name", "heading"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().slice(0, 80);
    }
  }
  return null;
}

/**
 * Dashboard de conversión (F3.7). Lee **solo** `AnalyticsAggregate` (más un conteo de contactos
 * nuevos), nunca `AnalyticsEvent` crudo: es la vista más consultada del panel. Todo filtrado por
 * la organización de la ruta (verificada por `OrganizationMembershipGuard`), y cada nombre que se
 * resuelve (página, bloque, formulario, enlace, QR) se busca también acotado a esa organización.
 */
@Injectable()
export class AnalyticsReportsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly plansService: PlansService,
  ) {}

  /**
   * Límite de historial del plan (F4.3, `analyticsHistoryDays`): el rango no puede empezar antes de
   * "hoy menos N días". Mismo 402 que el resto de los límites, así el panel ofrece subir de plan.
   * Los datos viejos no se borran por esto (eso es la retención, ADR-004): solo no se muestran.
   */
  async assertWithinHistoryLimit(organizationId: string, from: string): Promise<void> {
    const { plan } = await this.plansService.resolveEffectivePlan(organizationId);
    const maxDays = plan.limits.analyticsHistoryDays;
    if (maxDays === null) {
      return;
    }
    const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const requestedDays = Math.floor((today - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;
    if (requestedDays > maxDays) {
      throw new PlanLimitExceededException("analyticsHistoryDays", maxDays, requestedDays, {
        code: plan.code,
        name: plan.name,
      });
    }
  }

  /**
   * `skipHistoryLimit` es solo para quien ya aplicó el límite por su cuenta (el informe por cliente, F9.8, que decide qué comparaciones
   * caen dentro del historial del plan). Nunca lo pasa una ruta con la petición del usuario sin esa comprobación.
   */
  async overview(
    organizationId: string,
    query: AnalyticsOverviewQuery,
    options: { skipHistoryLimit?: boolean } = {},
  ): Promise<AnalyticsOverviewResponse> {
    if (!options.skipHistoryLimit) {
      await this.assertWithinHistoryLimit(organizationId, query.from);
    }
    if (query.siteId) {
      const site = await this.prisma.site.findFirst({
        where: { id: query.siteId, organizationId },
        select: { id: true },
      });
      if (!site) {
        throw new NotFoundException("Sitio no encontrado.");
      }
    }

    const rows = await this.prisma.analyticsAggregate.findMany({
      where: {
        organizationId,
        period: { gte: query.from, lte: query.to },
        // Con un sitio elegido, sus métricas más las de nivel organización (enlaces cortos y QR,
        // que no pertenecen a ningún sitio): el panel las rotula como "de toda la organización".
        ...(query.siteId ? { OR: [{ siteId: query.siteId }, { siteId: null }] } : {}),
      },
      select: { period: true, metric: true, value: true },
    });

    const metrics = new MetricTotals();
    for (const row of rows) {
      metrics.add(row.period, row.metric, row.value);
    }

    const newContacts = await this.prisma.contact.count({
      where: {
        organizationId,
        createdAt: {
          gte: new Date(`${query.from}T00:00:00.000Z`),
          lt: new Date(Date.parse(`${query.to}T00:00:00.000Z`) + DAY_MS),
        },
      },
    });

    const totals = {
      pageViews: metrics.sum("page_view"),
      visitors: metrics.sum("page_view:visitors"),
      blockClicks: metrics.sum("block_click"),
      whatsappClicks: metrics.sum("whatsapp_click"),
      formSubmits: metrics.sum("form_submit"),
      leads: metrics.sum("lead_created"),
      newContacts,
      shortLinkClicks: metrics.sum("short_link_click"),
      qrScans: metrics.sum("qr_visit"),
    };

    const series: AnalyticsSeriesPoint[] = daysBetween(query.from, query.to).map((date) => ({
      date,
      pageViews: metrics.onDay(date, "page_view"),
      visitors: metrics.onDay(date, "page_view:visitors"),
      clicks: metrics.onDay(date, "block_click") + metrics.onDay(date, "whatsapp_click"),
      leads: metrics.onDay(date, "lead_created"),
    }));

    const countryNames = new Intl.DisplayNames(["es"], { type: "region" });

    return {
      range: { from: query.from, to: query.to },
      siteId: query.siteId ?? null,
      totals,
      conversionRate: totals.visitors > 0 ? totals.leads / totals.visitors : null,
      series,
      funnel: [
        { step: "visitors", value: totals.visitors },
        { step: "clicks", value: totals.blockClicks + totals.whatsappClicks },
        { step: "formSubmits", value: totals.formSubmits },
        { step: "leads", value: totals.leads },
      ],
      devices: this.breakdown(metrics.withPrefix("page_view:device:"), (key) => DEVICE_LABELS[key] ?? key),
      countries: this.breakdown(metrics.withPrefix("page_view:country:"), (key) => {
        try {
          return countryNames.of(key) ?? key;
        } catch {
          return key;
        }
      }),
      utmSources: this.breakdown(metrics.withPrefix("page_view:utm_source:"), (key) => key),
      utmCampaigns: this.breakdown(metrics.withPrefix("page_view:utm_campaign:"), (key) => key),
      topPages: await this.topPages(organizationId, metrics.withPrefix("page_view:subject:")),
      topBlocks: await this.topBlocks(
        organizationId,
        mergeCounts(metrics.withPrefix("block_click:subject:"), metrics.withPrefix("whatsapp_click:subject:")),
      ),
      forms: await this.topForms(
        organizationId,
        metrics.withPrefix("form_submit:subject:"),
        metrics.withPrefix("lead_created:subject:"),
      ),
      shortLinks: await this.topShortLinks(organizationId, metrics.withPrefix("short_link_click:subject:")),
      qrCodes: await this.topQrCodes(organizationId, metrics.withPrefix("qr_visit:subject:")),
    };
  }

  private breakdown(values: Map<string, number>, label: (key: string) => string): AnalyticsBreakdownRow[] {
    return topEntries(values).map(([key, value]) => ({ key, label: label(key), value }));
  }

  /** Arma las filas de un ranking a partir de lo que se encontró en la base. Lo que ya no existe
   *  se muestra igual (el conteo es real) pero marcado como eliminado. */
  private subjectRows(
    top: Array<[string, number]>,
    found: Map<string, { label: string | null; kind: string | null; detail: string | null }>,
    secondary?: Map<string, number>,
  ): AnalyticsSubjectRow[] {
    return top.map(([id, value]) => {
      const subject = found.get(id);
      return {
        id,
        label: subject?.label ?? null,
        kind: subject?.kind ?? null,
        detail: subject?.detail ?? null,
        value,
        secondaryValue: secondary ? (secondary.get(id) ?? 0) : null,
        deleted: !subject,
      };
    });
  }

  private async topPages(organizationId: string, values: Map<string, number>): Promise<AnalyticsSubjectRow[]> {
    const top = topEntries(values);
    const pages = await this.prisma.page.findMany({
      where: { id: { in: top.map(([id]) => id) }, site: { organizationId } },
      select: { id: true, slug: true, isHome: true, site: { select: { name: true } } },
    });
    return this.subjectRows(
      top,
      new Map(pages.map((page) => [page.id, { label: page.isHome ? "Inicio" : `/${page.slug}`, kind: null, detail: page.site.name }])),
    );
  }

  private async topBlocks(organizationId: string, values: Map<string, number>): Promise<AnalyticsSubjectRow[]> {
    const top = topEntries(values);
    const blocks = await this.prisma.block.findMany({
      where: { id: { in: top.map(([id]) => id) }, page: { site: { organizationId } } },
      select: {
        id: true,
        type: true,
        page: { select: { slug: true, isHome: true } },
        versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { config: true } },
      },
    });
    return this.subjectRows(
      top,
      new Map(
        blocks.map((block) => [
          block.id,
          {
            label: blockOwnLabel(block.versions[0]?.config),
            kind: block.type,
            detail: block.page.isHome ? "Inicio" : `/${block.page.slug}`,
          },
        ]),
      ),
    );
  }

  private async topForms(
    organizationId: string,
    submits: Map<string, number>,
    leads: Map<string, number>,
  ): Promise<AnalyticsSubjectRow[]> {
    const top = topEntries(submits);
    const forms = await this.prisma.form.findMany({
      where: { id: { in: top.map(([id]) => id) }, site: { organizationId } },
      select: { id: true, name: true, site: { select: { name: true } } },
    });
    return this.subjectRows(
      top,
      new Map(forms.map((form) => [form.id, { label: form.name, kind: null, detail: form.site.name }])),
      leads,
    );
  }

  private async topShortLinks(organizationId: string, values: Map<string, number>): Promise<AnalyticsSubjectRow[]> {
    const top = topEntries(values);
    const links = await this.prisma.shortLink.findMany({
      where: { id: { in: top.map(([id]) => id) }, organizationId },
      select: { id: true, slug: true, destinationUrl: true },
    });
    return this.subjectRows(
      top,
      new Map(links.map((link) => [link.id, { label: `/s/${link.slug}`, kind: null, detail: link.destinationUrl }])),
    );
  }

  private async topQrCodes(organizationId: string, values: Map<string, number>): Promise<AnalyticsSubjectRow[]> {
    const top = topEntries(values);
    const qrCodes = await this.prisma.qrCode.findMany({
      where: { id: { in: top.map(([id]) => id) }, organizationId },
      select: { id: true, directUrl: true, shortLink: { select: { slug: true } } },
    });
    return this.subjectRows(
      top,
      new Map(
        qrCodes.map((qr) => [
          qr.id,
          {
            label: qr.shortLink ? `QR de /s/${qr.shortLink.slug}` : "QR directo",
            kind: null,
            detail: qr.directUrl,
          },
        ]),
      ),
    );
  }
}
