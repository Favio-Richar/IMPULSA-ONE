"use client";

import type { BookableServiceResponse, BookingBranchResponse, BookingStaffResponse } from "@impulza/contracts";
import { manualBookingSchema, zonedWallTimeToUtc } from "@impulza/validation";
import { Button, Input, Select } from "@impulza/ui";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useCreateManualBooking } from "../../lib/hooks/use-agenda";
import { durationLabel } from "../bookings/bookable-services";

/**
 * Anotar una reserva tomada por teléfono o en el local (F5.3, F7.9a). Día y hora se escriben en la zona del
 * negocio y se convierten acá; el servidor la valida y la base impide que se pise con otra.
 */
export function NewBookingForm({
  organizationId,
  siteId,
  timeZone,
  services,
  branches = [],
  staff = [],
  defaultDate,
  onDone,
}: {
  organizationId: string;
  siteId: string;
  timeZone: string;
  services: readonly BookableServiceResponse[];
  branches?: readonly BookingBranchResponse[];
  staff?: readonly BookingStaffResponse[];
  defaultDate: string;
  onDone: () => void;
}): React.JSX.Element {
  const createMutation = useCreateManualBooking(organizationId);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [branchId, setBranchId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("10:00");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Filtrar profesionales que atienden el servicio elegido (o todos si no tienen restricciones)
  const eligibleStaff = staff.filter(
    (s) => s.active && (s.serviceIds.length === 0 || s.serviceIds.includes(serviceId)),
  );

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
      branchId: branchId || undefined,
      staffId: staffId || undefined,
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
        setError("Ese horario se pisa con otra reserva confirmada para este profesional. Elige otra hora.");
      } else if (caught instanceof ApiError && caught.status === 403) {
        setError("Tu rol no permite anotar reservas.");
      } else {
        setError("No se pudo guardar la reserva. Intenta de nuevo.");
      }
    }
  }

  const activeBranches = branches.filter((b) => b.active);

  return (
    <form onSubmit={submit} noValidate aria-label="Nueva reserva" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium text-foreground">Anotar una reserva</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Servicio"
          options={services.map((service) => ({
            value: service.id,
            label: `${service.name} (${durationLabel(service.durationMinutes)})`,
          }))}
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            setStaffId(""); // reset staff if not eligible
          }}
        />

        {activeBranches.length > 0 ? (
          <Select
            label="Sucursal (opcional)"
            options={[
              { value: "", label: "Sin sucursal asignada" },
              ...activeBranches.map((b) => ({ value: b.id, label: b.name })),
            ]}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          />
        ) : null}

        {eligibleStaff.length > 0 ? (
          <Select
            label="Profesional (opcional)"
            options={[
              { value: "", label: "Cualquiera / Sin asignar" },
              ...eligibleStaff.map((s) => ({ value: s.id, label: s.name + (s.title ? ` (${s.title})` : "") })),
            ]}
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          />
        ) : null}

        <Input label="Día" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <Input label="Hora" type="time" value={time} step={900} onChange={(e) => setTime(e.target.value)} required />
        <Input label="Nombre del cliente" placeholder="Ej. Camila Valenzuela" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Correo electrónico" type="email" placeholder="cliente@ejemplo.cl" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input label="Teléfono (opcional)" placeholder="+56 9 1234 5678" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input label="Nota interna (opcional)" placeholder="Detalle para la ficha" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" loading={createMutation.isPending}>
          Guardar reserva
        </Button>
      </div>
    </form>
  );
}
