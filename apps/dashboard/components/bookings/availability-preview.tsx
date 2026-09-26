"use client";

import type { BookableServiceResponse } from "@impulza/contracts";
import { addDaysToDate, localDateOf } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState, Select } from "@impulza/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useBookingAvailability } from "../../lib/hooks/use-booking-setup";
import { durationLabel } from "./bookable-services";

const DAYS = 7;

/** Mayúscula solo en la primera letra ("Sáb, 26 sept"). */
function sentenceCase(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es-CL") + text.slice(1);
}

/**
 * Lo que verá el cliente (F5.1): las horas libres de un servicio, calculadas en el servidor con el
 * horario, los bloqueos, la anticipación y el margen. Las horas se muestran en la zona del negocio.
 */
export function AvailabilityPreview({
  organizationId,
  siteId,
  timeZone,
  services,
}: {
  organizationId: string;
  siteId: string;
  timeZone: string;
  services: readonly BookableServiceResponse[];
}): React.JSX.Element {
  const active = services.filter((service) => service.active);
  const today = localDateOf(new Date(), timeZone);
  const [serviceId, setServiceId] = useState(active[0]?.id ?? "");
  const [from, setFrom] = useState(today);
  const selected = active.find((service) => service.id === serviceId) ?? active[0];
  const availabilityQuery = useBookingAvailability(organizationId, siteId, selected ? { serviceId: selected.id, from, days: DAYS } : null);
  const dayFormat = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const timeFormat = new Intl.DateTimeFormat("es-CL", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Así verán tus horarios</CardTitle>
        <CardDescription>Horas libres calculadas con tu horario, tus días bloqueados y tus reglas, en la hora de tu zona.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {active.length === 0 ? (
          <EmptyState title="Sin servicios disponibles" description="Agrega o activa un servicio para ver sus horarios." />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="w-full sm:w-72">
                <Select
                  label="Servicio"
                  options={active.map((service) => ({ value: service.id, label: `${service.name} · ${durationLabel(service.durationMinutes)}` }))}
                  value={selected?.id}
                  onChange={(event) => setServiceId(event.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={from <= today} onClick={() => setFrom((current) => (addDaysToDate(current, -DAYS) < today ? today : addDaysToDate(current, -DAYS)))} aria-label="Semana anterior">
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setFrom((current) => addDaysToDate(current, DAYS))} aria-label="Semana siguiente">
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            {availabilityQuery.isPending ? (
              <LoadingState label="Calculando horarios…" />
            ) : availabilityQuery.isError ? (
              <ErrorState onRetry={() => availabilityQuery.refetch()} />
            ) : (
              <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Horarios libres por día">
                {availabilityQuery.data.days.map((day) => (
                  <li key={day.date} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-date={day.date}>
                    <p className="text-sm font-medium text-foreground">{sentenceCase(dayFormat.format(new Date(`${day.date}T12:00:00Z`)))}</p>
                    {day.slots.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Sin horas libres</p>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {day.slots.map((slot) => (
                          <li key={slot} className="rounded-md border border-border bg-surface px-2 py-1 text-xs tabular-nums text-foreground">
                            {timeFormat.format(new Date(slot))}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
