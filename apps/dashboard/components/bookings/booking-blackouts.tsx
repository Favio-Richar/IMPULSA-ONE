"use client";

import { addDaysToDate, localDateOf, zonedWallTimeToUtc } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { CalendarOff } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useBookingBlackouts, useCreateBookingBlackout, useDeleteBookingBlackout } from "../../lib/hooks/use-booking-setup";
import { ConfirmButton } from "../confirm-button";

/** Medianoche local de `date` en `timeZone`; si no existe (salto de horario), la primera hora que sí. */
function startOfLocalDay(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  for (let hour = 0; hour < 3; hour++) {
    const instant = zonedWallTimeToUtc({ year, month, day, hour, minute: 0 }, timeZone);
    if (instant) return instant;
  }
  return new Date(`${date}T00:00:00Z`);
}

function formatRange(startsAt: string, endsAt: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat("es-CL", { timeZone, weekday: "short", day: "numeric", month: "short" });
  const first = localDateOf(new Date(startsAt), timeZone);
  // El fin es exclusivo (medianoche del día siguiente): se muestra el último día bloqueado.
  const last = localDateOf(new Date(new Date(endsAt).getTime() - 1), timeZone);
  const text = first === last ? day.format(new Date(startsAt)) : `${day.format(new Date(startsAt))} al ${day.format(new Date(new Date(endsAt).getTime() - 1))}`;
  return text.charAt(0).toLocaleUpperCase("es-CL") + text.slice(1);
}

export function BookingBlackouts({ organizationId, siteId, timeZone }: { organizationId: string; siteId: string; timeZone: string }): React.JSX.Element {
  const blackoutsQuery = useBookingBlackouts(organizationId, siteId);
  const createMutation = useCreateBookingBlackout(organizationId, siteId);
  const deleteMutation = useDeleteBookingBlackout(organizationId, siteId);
  const today = localDateOf(new Date(), timeZone);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!from || !to || to < from) {
      setError("El último día tiene que ser igual o posterior al primero.");
      return;
    }
    setError(null);
    try {
      await createMutation.mutateAsync({
        startsAt: startOfLocalDay(from, timeZone).toISOString(),
        endsAt: startOfLocalDay(addDaysToDate(to, 1), timeZone).toISOString(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setReason("");
    } catch (caught) {
      const body = caught instanceof ApiError ? (caught.body as { message?: unknown } | undefined) : undefined;
      setError(typeof body?.message === "string" ? body.message : "No se pudo bloquear. Intenta de nuevo.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Días bloqueados</CardTitle>
        <CardDescription>Feriados, vacaciones o días sin atención: esos días no se ofrece ninguna hora.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={add} noValidate aria-label="Bloquear días" className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          <Input label="Desde" type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} />
          <Input label="Hasta (incluido)" type="date" value={to} min={from || today} onChange={(e) => setTo(e.target.value)} />
          <Input label="Motivo (opcional)" placeholder="Vacaciones" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" loading={createMutation.isPending} className="sm:mt-6">
            Bloquear
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-danger sm:col-span-4">
              {error}
            </p>
          ) : null}
        </form>

        {blackoutsQuery.isPending ? (
          <LoadingState label="Cargando días bloqueados…" />
        ) : blackoutsQuery.isError ? (
          <ErrorState onRetry={() => blackoutsQuery.refetch()} />
        ) : blackoutsQuery.data.length === 0 ? (
          <EmptyState title="Sin días bloqueados" description="Tu horario se aplica todas las semanas." />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" aria-label="Días bloqueados">
            {blackoutsQuery.data.map((blackout) => (
              <li key={blackout.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <p className="flex items-center gap-2 text-sm text-foreground">
                  <CalendarOff className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>{formatRange(blackout.startsAt, blackout.endsAt, timeZone)}</span>
                  {blackout.reason ? <span className="text-muted-foreground">· {blackout.reason}</span> : null}
                </p>
                <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Quitar?" loading={deleteMutation.isPending} onConfirm={() => deleteMutation.mutate(blackout.id)}>
                  Quitar
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
