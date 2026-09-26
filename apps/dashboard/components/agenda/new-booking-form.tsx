"use client";

import type { BookableServiceResponse } from "@impulza/contracts";
import { manualBookingSchema, zonedWallTimeToUtc } from "@impulza/validation";
import { Button, Input, Select } from "@impulza/ui";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useCreateManualBooking } from "../../lib/hooks/use-agenda";
import { durationLabel } from "../bookings/bookable-services";

/**
 * Anotar una reserva tomada por teléfono o en el local (F5.3). Día y hora se escriben en la zona del
 * negocio y se convierten acá; el servidor la valida y la base impide que se pise con otra.
 */
export function NewBookingForm({
  organizationId,
  siteId,
  timeZone,
  services,
  defaultDate,
  onDone,
}: {
  organizationId: string;
  siteId: string;
  timeZone: string;
  services: readonly BookableServiceResponse[];
  defaultDate: string;
  onDone: () => void;
}): React.JSX.Element {
  const createMutation = useCreateManualBooking(organizationId);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("10:00");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    const [hour, minute] = time.split(":").map(Number) as [number, number];
    const startsAt = date && time ? zonedWallTimeToUtc({ year, month, day, hour, minute }, timeZone) : null;
    if (!startsAt) {
      setError("Esa hora no existe ese día (cambio de horario). Elige otra.");
      return;
    }
    const digits = phone.replace(/[\s()-]/g, "");
    const parsed = manualBookingSchema.safeParse({
      siteId,
      serviceId,
      startsAt: startsAt.toISOString(),
      name,
      email,
      ...(digits ? { phone: digits.startsWith("+") ? digits : `+56${digits.replace(/^0+/, "")}` } : {}),
      ...(note.trim() ? { note } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisa los datos.");
      return;
    }
    setError(null);
    try {
      await createMutation.mutateAsync(parsed.data);
      onDone();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError("Ese horario se pisa con otra reserva confirmada. Elige otra hora.");
      } else if (caught instanceof ApiError && caught.status === 403) {
        setError("Tu rol no permite anotar reservas.");
      } else {
        setError("No se pudo guardar la reserva. Intenta de nuevo.");
      }
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Nueva reserva" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium text-foreground">Anotar una reserva</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Select
          label="Servicio"
          options={services.map((service) => ({ value: service.id, label: `${service.name} · ${durationLabel(service.durationMinutes)}` }))}
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
        />
        <Input label="Día" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Hora" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
        <Input label="Nombre del cliente" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <Input label="Correo" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <Input label="Teléfono (opcional)" type="tel" placeholder="+56 9 1234 5678" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
        <div className="sm:col-span-3">
          <Input label="Nota (opcional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={createMutation.isPending}>
          Guardar reserva
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
