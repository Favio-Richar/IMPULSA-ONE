"use client";

import type { BookableServiceResponse, BookingBranchResponse, BookingStaffResponse } from "@impulza/contracts";
import {
  bookingStaffSchema,
  MAX_STAFF_PER_SITE,
  minutesOfDay,
  WEEKDAY_LABELS,
  type BookingStaffInput,
  type Weekday,
  type WeeklyHours,
} from "@impulza/validation";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
} from "@impulza/ui";
import { Building, Clock, Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import {
  useBookableServices,
  useBookingBranches,
  useBookingStaff,
  useCreateBookingStaff,
  useDeleteBookingStaff,
  useUpdateBookingStaff,
} from "../../lib/hooks/use-booking-setup";
import { ConfirmButton } from "../confirm-button";

const DAY_ORDER: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const DEFAULT_STAFF_WEEKLY_HOURS: WeeklyHours = {
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "18:00" }],
  sat: [],
  sun: [],
};

function formatTime(minutes: number): string {
  return minutes >= 24 * 60 ? "24:00" : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

interface StaffDraft {
  name: string;
  title: string;
  email: string;
  phone: string;
  branchId: string;
  serviceIds: string[];
  active: boolean;
  weeklyHours: WeeklyHours | null;
}

const EMPTY_DRAFT: StaffDraft = {
  name: "",
  title: "",
  email: "",
  phone: "",
  branchId: "",
  serviceIds: [],
  active: true,
  weeklyHours: null,
};

function draftOf(staff: BookingStaffResponse): StaffDraft {
  return {
    name: staff.name,
    title: staff.title ?? "",
    email: staff.email ?? "",
    phone: staff.phone ?? "",
    branchId: staff.branchId ?? "",
    serviceIds: staff.serviceIds ?? [],
    active: staff.active,
    weeklyHours: staff.weeklyHours,
  };
}

function toInput(draft: StaffDraft): { input?: BookingStaffInput; error?: string } {
  const parsed = bookingStaffSchema.safeParse({
    name: draft.name.trim(),
    title: draft.title.trim() || undefined,
    email: draft.email.trim() || undefined,
    phone: draft.phone.trim() || undefined,
    branchId: draft.branchId.trim() || undefined,
    serviceIds: draft.serviceIds.length > 0 ? draft.serviceIds : undefined,
    active: draft.active,
    weeklyHours: draft.weeklyHours ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos del profesional." };
  }
  return { input: parsed.data };
}

/**
 * Gestión de profesionales o prestadores del sitio (F7.9a, F7.9b).
 */
export function BookingStaff({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const staffQuery = useBookingStaff(organizationId, siteId);
  const branchesQuery = useBookingBranches(organizationId, siteId);
  const servicesQuery = useBookableServices(organizationId, siteId);

  if (staffQuery.isPending || branchesQuery.isPending || servicesQuery.isPending) {
    return <LoadingState label="Cargando equipo de atención…" />;
  }
  if (staffQuery.isError || branchesQuery.isError || servicesQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void staffQuery.refetch();
          void branchesQuery.refetch();
          void servicesQuery.refetch();
        }}
      />
    );
  }

  const staff = staffQuery.data;
  const branches = branchesQuery.data;
  const services = servicesQuery.data;
  const full = staff.length >= MAX_STAFF_PER_SITE;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profesionales y equipo de atención</CardTitle>
        <CardDescription>
          Si tu negocio cuenta con varios colaboradores, agrégalos acá. Cada uno puede tener su propio horario semanal o heredar el del sitio, y tus clientes podrán elegir con quién atenderse.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {staff.length === 0 ? (
          <EmptyState
            title="Calendario único"
            description="Sin profesionales adicionales dados de alta, el sitio opera con un único calendario general."
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface" aria-label="Profesionales">
            {staff.map((member) => (
              <StaffRow
                key={member.id}
                organizationId={organizationId}
                siteId={siteId}
                member={member}
                branches={branches}
                services={services}
              />
            ))}
          </ul>
        )}
        {full ? (
          <p className="text-sm text-muted-foreground">Llegaste al límite de {MAX_STAFF_PER_SITE} profesionales por sitio.</p>
        ) : (
          <NewStaffForm organizationId={organizationId} siteId={siteId} branches={branches} services={services} />
        )}
      </CardContent>
    </Card>
  );
}

function StaffRow({
  organizationId,
  siteId,
  member,
  branches,
  services,
}: {
  organizationId: string;
  siteId: string;
  member: BookingStaffResponse;
  branches: readonly BookingBranchResponse[];
  services: readonly BookableServiceResponse[];
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const deleteMutation = useDeleteBookingStaff(organizationId, siteId);

  const branchName = branches.find((b) => b.id === member.branchId)?.name;
  const assignedServices = services.filter((s) => member.serviceIds.includes(s.id));

  if (editing) {
    return (
      <li className="p-4">
        <EditStaffForm
          organizationId={organizationId}
          siteId={siteId}
          member={member}
          branches={branches}
          services={services}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4" data-staff={member.name}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          {member.name}
          {member.title ? <span className="text-xs font-normal text-muted-foreground">({member.title})</span> : null}
          {!member.active ? <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-normal text-muted-foreground">Inactivo</span> : null}
          {member.weeklyHours ? (
            <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Clock className="size-3" aria-hidden="true" />
              Horario propio
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <Clock className="size-3" aria-hidden="true" />
              Horario del sitio
            </span>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {branchName ? (
            <span className="inline-flex items-center gap-1">
              <Building className="size-3.5" aria-hidden="true" />
              {branchName}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Building className="size-3.5" aria-hidden="true" />
              Todas las sucursales
            </span>
          )}
          {member.email ? (
            <span className="inline-flex items-center gap-1">
              <Mail className="size-3.5" aria-hidden="true" />
              {member.email}
            </span>
          ) : null}
          {member.phone ? (
            <span className="inline-flex items-center gap-1">
              <Phone className="size-3.5" aria-hidden="true" />
              {member.phone}
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Servicios: {assignedServices.length > 0 ? assignedServices.map((s) => s.name).join(", ") : "Todos los servicios"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Editar ${member.name}`}>
          <Pencil className="size-4" aria-hidden="true" />
          Editar
        </Button>
        <ConfirmButton
          variant="ghost"
          size="sm"
          confirmLabel="¿Borrar profesional?"
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(member.id)}
        >
          Borrar
        </ConfirmButton>
      </div>
    </li>
  );
}

function NewStaffForm({
  organizationId,
  siteId,
  branches,
  services,
}: {
  organizationId: string;
  siteId: string;
  branches: readonly BookingBranchResponse[];
  services: readonly BookableServiceResponse[];
}): React.JSX.Element {
  const createMutation = useCreateBookingStaff(organizationId, siteId);
  return (
    <StaffForm
      key="new"
      title="Agregar profesional"
      initial={EMPTY_DRAFT}
      submitLabel="Agregar profesional"
      pending={createMutation.isPending}
      branches={branches}
      services={services}
      onSubmit={async (input) => {
        await createMutation.mutateAsync(input);
      }}
      resetOnSuccess
    />
  );
}

function EditStaffForm({
  organizationId,
  siteId,
  member,
  branches,
  services,
  onDone,
}: {
  organizationId: string;
  siteId: string;
  member: BookingStaffResponse;
  branches: readonly BookingBranchResponse[];
  services: readonly BookableServiceResponse[];
  onDone: () => void;
}): React.JSX.Element {
  const updateMutation = useUpdateBookingStaff(organizationId, siteId);
  return (
    <StaffForm
      key={member.id}
      title={`Editar ${member.name}`}
      initial={draftOf(member)}
      submitLabel="Guardar cambios"
      pending={updateMutation.isPending}
      branches={branches}
      services={services}
      onCancel={onDone}
      onSubmit={async (input, draft) => {
        await updateMutation.mutateAsync({
          staffId: member.id,
          changes: {
            ...input,
            weeklyHours: draft.weeklyHours,
          },
        });
        onDone();
      }}
    />
  );
}

function StaffForm({
  title,
  initial,
  submitLabel,
  pending,
  branches,
  services,
  onSubmit,
  onCancel,
  resetOnSuccess,
}: {
  title: string;
  initial: StaffDraft;
  submitLabel: string;
  pending: boolean;
  branches: readonly BookingBranchResponse[];
  services: readonly BookableServiceResponse[];
  onSubmit: (input: BookingStaffInput, draft: StaffDraft) => Promise<void>;
  onCancel?: () => void;
  resetOnSuccess?: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const branchOptions = [
    { value: "", label: "Todas las sucursales (flotante)" },
    ...branches.map((b) => ({ value: b.id, label: b.name })),
  ];

  function toggleService(serviceId: string) {
    const exists = draft.serviceIds.includes(serviceId);
    setDraft({
      ...draft,
      serviceIds: exists ? draft.serviceIds.filter((id) => id !== serviceId) : [...draft.serviceIds, serviceId],
    });
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const { input, error: validationError } = toInput(draft);
    if (validationError || !input) {
      setError(validationError ?? "Revisa los campos.");
      return;
    }
    setError(null);
    try {
      await onSubmit(input, draft);
      if (resetOnSuccess) setDraft(EMPTY_DRAFT);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError("No se puede eliminar o modificar este profesional porque tiene reservas activas asociadas.");
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError("No se pudo guardar el profesional. Intenta de nuevo.");
      }
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={title} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nombre y apellido"
          placeholder="Ej. Dra. Camila Valenzuela"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          required
        />
        <Input
          label="Cargo o especialidad"
          placeholder="Ej. Kinesióloga, Barbero, Odontólogo"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <Input
          label="Correo electrónico"
          type="email"
          placeholder="profesional@ejemplo.cl"
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
        />
        <Input
          label="Teléfono"
          placeholder="+56 9 8765 4321"
          value={draft.phone}
          onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
        />
        {branches.length > 0 ? (
          <div className="sm:col-span-2">
            <Select
              label="Sucursal asignada"
              options={branchOptions}
              value={draft.branchId}
              onChange={(e) => setDraft({ ...draft, branchId: e.target.value })}
            />
          </div>
        ) : null}
        {services.length > 0 ? (
          <div className="sm:col-span-2 flex flex-col gap-2">
            <label className="text-sm font-medium text-foreground">Servicios que atiende</label>
            <p className="text-xs text-muted-foreground">Si no seleccionas ninguno, atenderá todos los servicios del sitio.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border border-border p-3">
              {services.map((srv) => (
                <label key={srv.id} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.serviceIds.includes(srv.id)}
                    onChange={() => toggleService(srv.id)}
                    className="size-4 rounded border-border"
                  />
                  <span>{srv.name}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {/* Sección de Horarios Semanales (F7.9b) */}
        <div className="sm:col-span-2 flex flex-col gap-3 rounded-lg border border-border p-4 bg-background">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">Horario semanal de atención</p>
              <p className="text-xs text-muted-foreground">
                Define si este profesional atiende en el horario general del sitio o tiene días y horas personalizados.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={draft.weeklyHours === null ? "primary" : "secondary"}
                size="sm"
                onClick={() => setDraft({ ...draft, weeklyHours: null })}
              >
                Heredar del sitio
              </Button>
              <Button
                type="button"
                variant={draft.weeklyHours !== null ? "primary" : "secondary"}
                size="sm"
                onClick={() => setDraft({ ...draft, weeklyHours: draft.weeklyHours ?? DEFAULT_STAFF_WEEKLY_HOURS })}
              >
                Horario propio
              </Button>
            </div>
          </div>

          {draft.weeklyHours !== null ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface mt-2" aria-label="Horario semanal del profesional">
              {DAY_ORDER.map((day) => (
                <StaffDayRow
                  key={day}
                  day={day}
                  windows={draft.weeklyHours![day]}
                  onChange={(windows) =>
                    setDraft({
                      ...draft,
                      weeklyHours: { ...draft.weeklyHours!, [day]: windows },
                    })
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Este profesional atiende en los horarios generales definidos para el sitio.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2 sm:col-span-2">
          <input
            type="checkbox"
            id={`active-staff-${title}`}
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            className="size-4 rounded border-border"
          />
          <label htmlFor={`active-staff-${title}`} className="text-sm text-foreground">
            Profesional activo para recibir citas
          </label>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="flex items-center justify-end gap-2 pt-2">
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" size="sm" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function StaffDayRow({
  day,
  windows,
  onChange,
}: {
  day: Weekday;
  windows: WeeklyHours[Weekday];
  onChange: (windows: WeeklyHours[Weekday]) => void;
}): React.JSX.Element {
  const open = windows.length > 0;
  const label = WEEKDAY_LABELS[day];

  function setWindow(index: number, field: "start" | "end", value: string): void {
    onChange(windows.map((window, i) => (i === index ? { ...window, [field]: value } : window)));
  }

  function addWindow(): void {
    const lastEnd = windows.at(-1)?.end ?? "09:00";
    const startMinutes = Math.min(minutesOfDay(lastEnd), 22 * 60);
    onChange([...windows, { start: formatTime(startMinutes), end: formatTime(Math.min(startMinutes + 120, 24 * 60)) }]);
  }

  return (
    <li className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-start sm:gap-3 text-xs" data-day={day}>
      <label className="flex w-28 shrink-0 items-center gap-2 pt-1.5 font-medium text-foreground">
        <input
          type="checkbox"
          className="size-3.5 accent-[var(--color-primary)]"
          checked={open}
          onChange={(event) => onChange(event.target.checked ? [{ start: "09:00", end: "18:00" }] : [])}
          aria-label={`${label} activo`}
        />
        {label}
      </label>
      {open ? (
        <div className="flex flex-1 flex-col gap-1.5">
          {windows.map((window, index) => (
            <div key={index} className="flex flex-wrap items-center gap-1.5">
              <input
                type="time"
                step={300}
                value={window.start}
                onChange={(event) => setWindow(index, "start", event.target.value)}
                aria-label={`${label}, tramo ${index + 1}, desde`}
                className="h-8 rounded border border-border-strong bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-focus-ring)]"
              />
              <span className="text-muted-foreground">a</span>
              <input
                type="time"
                step={300}
                value={window.end === "24:00" ? "23:59" : window.end}
                onChange={(event) => setWindow(index, "end", event.target.value === "23:59" ? "24:00" : event.target.value)}
                aria-label={`${label}, tramo ${index + 1}, hasta`}
                className="h-8 rounded border border-border-strong bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-focus-ring)]"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(windows.filter((_, i) => i !== index))}
                aria-label={`Quitar el tramo ${index + 1}`}
                className="h-7 w-7 p-0"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {windows.length < 4 ? (
            <Button type="button" variant="ghost" size="sm" className="self-start h-7 text-xs px-2" onClick={addWindow}>
              <Plus className="size-3.5 mr-1" aria-hidden="true" />
              Tramo
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="pt-1.5 text-xs text-muted-foreground">Cerrado</p>
      )}
    </li>
  );
}
