"use client";

import type { BookingResponse, SiteResponse } from "@impulza/contracts";
import { addDaysToDate, BOOKING_STATUS_LABELS, localDateOf, weekdayOf, zonedWallTimeToUtc, type BookingStatusValue } from "@impulza/validation";
import { Button, buttonVariants, cn, EmptyState, ErrorState, LoadingState, Select } from "@impulza/ui";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAgenda } from "../../lib/hooks/use-agenda";
import { useBookableServices, useBookingBranches, useBookingSettings, useBookingStaff } from "../../lib/hooks/use-booking-setup";
import { BookingCard, formatMoney } from "./booking-card";
import { NewBookingForm } from "./new-booking-form";

type View = "day" | "week";

const STATUS_FILTERS: Array<{ value: "" | BookingStatusValue; label: string }> = [
  { value: "", label: "Todas" },
  { value: "CONFIRMED", label: BOOKING_STATUS_LABELS.CONFIRMED },
  { value: "PENDING_PAYMENT", label: BOOKING_STATUS_LABELS.PENDING_PAYMENT },
  { value: "COMPLETED", label: BOOKING_STATUS_LABELS.COMPLETED },
  { value: "NO_SHOW", label: BOOKING_STATUS_LABELS.NO_SHOW },
  { value: "CANCELLED", label: BOOKING_STATUS_LABELS.CANCELLED },
];

function sentenceCase(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es-CL") + text.slice(1);
}

/** Medianoche local de `date` en `timeZone` (o la primera hora que exista, si hay salto). */
function startOfLocalDay(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  for (let hour = 0; hour < 3; hour++) {
    const instant = zonedWallTimeToUtc({ year, month, day, hour, minute: 0 }, timeZone);
    if (instant) return instant;
  }
  return new Date(`${date}T00:00:00Z`);
}

/** Lunes de la semana de `date`. */
function mondayOf(date: string): string {
  const weekday = weekdayOf(date); // 0 = domingo
  return addDaysToDate(date, weekday === 0 ? -6 : 1 - weekday);
}

/**
 * Agenda del negocio (F5.3): resumen de la semana, tira de días con cuántas reservas tiene cada uno,
 * vista de día o de semana, filtro por estado y anotar una reserva. Todo en la zona horaria del sitio.
 */
export function AgendaView({ organizationId, sites }: { organizationId: string; sites: readonly SiteResponse[] }): React.JSX.Element {
  const active = sites.filter((site) => site.status !== "ARCHIVED");
  if (active.length === 0) {
    return <EmptyState title="Todavía no tienes sitios" description="Crea tu sitio para empezar a recibir reservas." />;
  }
  return <AgendaForSites organizationId={organizationId} sites={active} />;
}

function AgendaForSites({ organizationId, sites: active }: { organizationId: string; sites: readonly SiteResponse[] }): React.JSX.Element {
  const [siteId, setSiteId] = useState(active[0]!.id);
  const settingsQuery = useBookingSettings(organizationId, siteId);
  const servicesQuery = useBookableServices(organizationId, siteId);
  const branchesQuery = useBookingBranches(organizationId, siteId);
  const staffQuery = useBookingStaff(organizationId, siteId);

  if (settingsQuery.isPending) return <LoadingState label="Cargando agenda…" />;
  if (settingsQuery.isError) return <ErrorState onRetry={() => settingsQuery.refetch()} />;

  const timeZone = settingsQuery.data.timeZone;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Reservas</h1>
          <p className="text-sm text-muted-foreground">Tu agenda, en la hora de {timeZone.replace(/_/g, " ").split("/").pop()}.</p>
        </div>
        {active.length > 1 ? (
          <div className="w-full sm:w-64">
            <Select label="Sitio" options={active.map((site) => ({ value: site.id, label: site.name }))} value={siteId} onChange={(e) => setSiteId(e.target.value)} />
          </div>
        ) : null}
      </div>

      {!settingsQuery.data.enabled ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Tu página todavía no recibe reservas en línea. Puedes anotarlas aquí igual.</p>
          <Link href={`/sitios/${siteId}/reservas`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Configurar reservas
          </Link>
        </div>
      ) : null}

      <AgendaBody
        key={siteId}
        organizationId={organizationId}
        siteId={siteId}
        timeZone={timeZone}
        services={servicesQuery.data ?? []}
        branches={branchesQuery.data ?? []}
        staff={staffQuery.data ?? []}
      />
    </div>
  );
}

function AgendaBody({
  organizationId,
  siteId,
  timeZone,
  services,
  branches,
  staff,
}: {
  organizationId: string;
  siteId: string;
  timeZone: string;
  services: NonNullable<ReturnType<typeof useBookableServices>["data"]>;
  branches: NonNullable<ReturnType<typeof useBookingBranches>["data"]>;
  staff: NonNullable<ReturnType<typeof useBookingStaff>["data"]>;
}): React.JSX.Element {
  const today = localDateOf(new Date(), timeZone);
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(today);
  const [status, setStatus] = useState<"" | BookingStatusValue>("");
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [staffFilter, setStaffFilter] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const weekStart = mondayOf(anchor);
  const range = view === "week" ? { first: weekStart, days: 7 } : { first: anchor, days: 1 };
  // La tira de días y el resumen siempre muestran la semana; la lista, la vista elegida.
  const weekQuery = useAgenda(organizationId, {
    siteId,
    from: startOfLocalDay(weekStart, timeZone).toISOString(),
    to: startOfLocalDay(addDaysToDate(weekStart, 7), timeZone).toISOString(),
  });

  const dayShort = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "short" });
  const dayLong = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  const rangeLabel = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "numeric", month: "short" });

  const byDay = useMemo(() => {
    const groups = new Map<string, BookingResponse[]>();
    for (const booking of weekQuery.data ?? []) {
      const date = localDateOf(new Date(booking.startsAt), timeZone);
      groups.set(date, [...(groups.get(date) ?? []), booking]);
    }
    return groups;
  }, [weekQuery.data, timeZone]);

  const summary = useMemo(() => {
    const bookings = weekQuery.data ?? [];
    const count = (value: BookingStatusValue) => bookings.filter((booking) => booking.status === value).length;
    // Ingreso estimado: confirmadas y atendidas con precio, por moneda.
    const income = new Map<string, number>();
    for (const booking of bookings) {
      if ((booking.status === "CONFIRMED" || booking.status === "COMPLETED") && booking.priceAmount !== null && booking.priceCurrency) {
        income.set(booking.priceCurrency, (income.get(booking.priceCurrency) ?? 0) + booking.priceAmount);
      }
    }
    return { confirmed: count("CONFIRMED"), completed: count("COMPLETED"), noShow: count("NO_SHOW"), income: [...income.entries()] };
  }, [weekQuery.data]);

  const visibleDays = Array.from({ length: range.days }, (_, i) => addDaysToDate(range.first, i));
  const filtered = (date: string) =>
    (byDay.get(date) ?? []).filter((booking) => {
      if (status && booking.status !== status) return false;
      if (branchFilter && booking.branchId !== branchFilter) return false;
      if (staffFilter && booking.staffId !== staffFilter) return false;
      return true;
    });
  const step = view === "week" ? 7 : 1;

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Resumen de la semana">
        <Stat label="Por atender" value={String(summary.confirmed)} />
        <Stat label="Atendidas" value={String(summary.completed)} />
        <Stat label="No llegaron" value={String(summary.noShow)} />
        <Stat
          label="Ingreso estimado"
          value={summary.income.length === 0 ? "—" : summary.income.map(([currency, amount]) => formatMoney(amount, currency)).join(" · ")}
        />
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAnchor(addDaysToDate(anchor, -step))} aria-label={view === "week" ? "Semana anterior" : "Día anterior"}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(today)}>
            Hoy
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(addDaysToDate(anchor, step))} aria-label={view === "week" ? "Semana siguiente" : "Día siguiente"}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          <p className="ml-1 text-sm font-medium text-foreground" aria-live="polite">
            {view === "week"
              ? `${rangeLabel.format(new Date(`${weekStart}T12:00:00Z`))} – ${rangeLabel.format(new Date(`${addDaysToDate(weekStart, 6)}T12:00:00Z`))}`
              : sentenceCase(dayLong.format(new Date(`${anchor}T12:00:00Z`)))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Vista" className="inline-flex rounded-md border border-border p-0.5">
            {(["day", "week"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={cn("rounded px-3 py-1.5 text-sm font-medium", view === value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-surface")}
              >
                {value === "day" ? "Día" : "Semana"}
              </button>
            ))}
          </div>

          {branches.length > 0 ? (
            <select
              aria-label="Filtrar por sucursal"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="h-9 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            >
              <option value="">Todas las sucursales</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : null}

          {staff.length > 0 ? (
            <select
              aria-label="Filtrar por profesional"
              value={staffFilter}
              onChange={(e) => setStaffFilter(e.target.value)}
              className="h-9 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            >
              <option value="">Todos los profesionales</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}

          <select
            aria-label="Filtrar por estado"
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | BookingStatusValue)}
            className="h-9 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
          >
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
          {services.length > 0 ? (
            <Button size="sm" onClick={() => setCreating(true)} disabled={creating}>
              <Plus className="size-4" aria-hidden="true" />
              Nueva reserva
            </Button>
          ) : null}
        </div>
      </div>

      {creating ? (
        <NewBookingForm
          organizationId={organizationId}
          siteId={siteId}
          timeZone={timeZone}
          services={services}
          branches={branches}
          staff={staff}
          defaultDate={anchor < today ? today : anchor}
          onDone={() => setCreating(false)}
        />
      ) : null}

      <ol className="grid grid-cols-7 gap-1.5" aria-label="Días de la semana">
        {Array.from({ length: 7 }, (_, i) => addDaysToDate(weekStart, i)).map((date) => {
          const count = (byDay.get(date) ?? []).filter((booking) => booking.status !== "CANCELLED").length;
          const selected = view === "day" ? date === anchor : false;
          return (
            <li key={date}>
              <button
                type="button"
                onClick={() => {
                  setAnchor(date);
                  setView("day");
                }}
                aria-pressed={selected}
                aria-label={`${sentenceCase(dayLong.format(new Date(`${date}T12:00:00Z`)))}: ${count} ${count === 1 ? "reserva" : "reservas"}`}
                className={cn(
                  "flex w-full flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-center transition-colors",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-surface",
                  date === today && !selected && "border-primary/50",
                )}
              >
                <span className="text-xs">{sentenceCase(dayShort.format(new Date(`${date}T12:00:00Z`)).replace(".", ""))}</span>
                <span className="text-base font-semibold tabular-nums">{Number(date.slice(8))}</span>
                <span className={cn("text-xs tabular-nums", selected ? "" : count > 0 ? "font-medium text-foreground" : "text-muted-foreground")}>
                  {count > 0 ? `${count}` : "–"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {weekQuery.isPending ? (
        <LoadingState label="Cargando reservas…" />
      ) : weekQuery.isError ? (
        <ErrorState onRetry={() => weekQuery.refetch()} />
      ) : visibleDays.every((date) => filtered(date).length === 0) ? (
        <EmptyState
          title={view === "week" ? "Sin reservas esta semana" : "Sin reservas este día"}
          description={status ? "Prueba con otro filtro." : "Cuando alguien reserve desde tu página, aparecerá aquí."}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {visibleDays
            .filter((date) => filtered(date).length > 0)
            .map((date) => (
              <section key={date} aria-labelledby={`dia-${date}`} className="flex flex-col gap-2">
                <h2 id={`dia-${date}`} className="text-sm font-semibold text-foreground">
                  {sentenceCase(dayLong.format(new Date(`${date}T12:00:00Z`)))}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {filtered(date).length} {filtered(date).length === 1 ? "reserva" : "reservas"}
                  </span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {filtered(date).map((booking) => (
                    <BookingCard key={booking.id} organizationId={organizationId} booking={booking} />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
