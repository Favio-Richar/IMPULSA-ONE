"use client";

import type { BookingSettingsResponse } from "@impulza/contracts";
import {
  bookingSettingsSchema,
  minutesOfDay,
  SLOT_INTERVALS,
  WEEKDAY_LABELS,
  type BookingSettingsInput,
  type Weekday,
  type WeeklyHours,
} from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Select } from "@impulza/ui";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useSaveBookingSettings } from "../../lib/hooks/use-booking-setup";

/** Lunes primero, como se lee una semana de trabajo. */
const DAY_ORDER: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKDAYS_ONLY: readonly Weekday[] = ["tue", "wed", "thu", "fri"];

const TIME_ZONES = [
  { value: "America/Santiago", label: "Chile (Santiago)" },
  { value: "America/Punta_Arenas", label: "Chile (Magallanes)" },
  { value: "Pacific/Easter", label: "Chile (Isla de Pascua)" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina" },
  { value: "America/Lima", label: "Perú" },
  { value: "America/Bogota", label: "Colombia" },
  { value: "America/Mexico_City", label: "México (Centro)" },
  { value: "America/Montevideo", label: "Uruguay" },
  { value: "America/Asuncion", label: "Paraguay" },
  { value: "America/La_Paz", label: "Bolivia" },
  { value: "America/Guayaquil", label: "Ecuador" },
  { value: "America/Caracas", label: "Venezuela" },
  { value: "Europe/Madrid", label: "España" },
];

const NOTICE_OPTIONS = [
  { value: "0", label: "Sin mínimo" },
  { value: "60", label: "1 hora antes" },
  { value: "120", label: "2 horas antes" },
  { value: "240", label: "4 horas antes" },
  { value: "720", label: "12 horas antes" },
  { value: "1440", label: "1 día antes" },
  { value: "2880", label: "2 días antes" },
];
const ADVANCE_OPTIONS = [7, 14, 30, 60, 90, 180, 365].map((days) => ({ value: String(days), label: days === 365 ? "Hasta 1 año" : `Hasta ${days} días` }));
const BUFFER_OPTIONS = [0, 5, 10, 15, 30, 60].map((minutes) => ({ value: String(minutes), label: minutes === 0 ? "Sin margen" : `${minutes} minutos` }));
const INTERVAL_OPTIONS = SLOT_INTERVALS.map((minutes) => ({ value: String(minutes), label: `Cada ${minutes} minutos` }));

type Draft = BookingSettingsInput;

function formatTime(minutes: number): string {
  return minutes >= 24 * 60 ? "24:00" : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function fromResponse(settings: BookingSettingsResponse): Draft {
  return {
    enabled: settings.enabled,
    timeZone: settings.timeZone,
    weeklyHours: settings.weeklyHours,
    minNoticeMinutes: settings.minNoticeMinutes,
    maxAdvanceDays: settings.maxAdvanceDays,
    bufferMinutes: settings.bufferMinutes,
    slotIntervalMinutes: settings.slotIntervalMinutes,
  };
}

/** Primer error de validación, dicho en términos de la pantalla ("Martes: …"). */
function firstError(draft: Draft): string | null {
  const result = bookingSettingsSchema.safeParse(draft);
  if (result.success) {
    return null;
  }
  const issue = result.error.issues[0]!;
  const day = issue.path[1];
  const dayLabel = issue.path[0] === "weeklyHours" && typeof day === "string" ? `${WEEKDAY_LABELS[day as Weekday]}: ` : "";
  return `${dayLabel}${issue.message}`;
}

export function BookingSettingsForm({
  organizationId,
  siteId,
  settings,
}: {
  organizationId: string;
  siteId: string;
  settings: BookingSettingsResponse;
}): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => fromResponse(settings));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const saveMutation = useSaveBookingSettings(organizationId, siteId);
  const timeZones = TIME_ZONES.some((zone) => zone.value === draft.timeZone) ? TIME_ZONES : [{ value: draft.timeZone, label: draft.timeZone }, ...TIME_ZONES];

  function update(changes: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...changes }));
    setSaved(false);
  }

  function updateDay(day: Weekday, windows: WeeklyHours[Weekday]): void {
    update({ weeklyHours: { ...draft.weeklyHours, [day]: windows } });
  }

  function copyMondayToWeekdays(): void {
    const monday = draft.weeklyHours.mon;
    update({ weeklyHours: { ...draft.weeklyHours, ...Object.fromEntries(WEEKDAYS_ONLY.map((day) => [day, monday.map((w) => ({ ...w }))])) } });
  }

  async function save(): Promise<void> {
    const problem = firstError(draft);
    setError(problem);
    if (problem) {
      return;
    }
    try {
      await saveMutation.mutateAsync(draft);
      setSaved(true);
    } catch {
      setError("No se pudo guardar. Revisa los datos e intenta de nuevo.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Horario de atención</CardTitle>
        <CardDescription>Tus clientes solo podrán reservar dentro de estos horarios, en la hora de tu zona.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <label className="flex items-start gap-3 rounded-lg border border-border p-4">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-[var(--color-primary)]"
            checked={draft.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">Recibir reservas en mi página</span>
            <span className="text-sm text-muted-foreground">
              Apagado, tu página no ofrece horarios aunque tengas servicios cargados.
            </span>
          </span>
        </label>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium text-foreground">
            <span>Días y horas</span>
            <Button type="button" variant="ghost" size="sm" onClick={copyMondayToWeekdays}>
              <Copy className="size-4" aria-hidden="true" />
              Copiar el lunes a martes–viernes
            </Button>
          </legend>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {DAY_ORDER.map((day) => (
              <DayRow key={day} day={day} windows={draft.weeklyHours[day]} onChange={(windows) => updateDay(day, windows)} />
            ))}
          </ul>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Zona horaria" options={timeZones} value={draft.timeZone} onChange={(event) => update({ timeZone: event.target.value })} />
          <Select
            label="Horas de inicio"
            helperText="Cada cuánto se ofrece un horario."
            options={INTERVAL_OPTIONS}
            value={String(draft.slotIntervalMinutes)}
            onChange={(event) => update({ slotIntervalMinutes: Number(event.target.value) })}
          />
          <Select
            label="Anticipación mínima"
            helperText="Para no recibir una reserva que no alcances a atender."
            options={NOTICE_OPTIONS}
            value={String(draft.minNoticeMinutes)}
            onChange={(event) => update({ minNoticeMinutes: Number(event.target.value) })}
          />
          <Select
            label="Con cuánta anticipación se puede reservar"
            options={ADVANCE_OPTIONS}
            value={String(draft.maxAdvanceDays)}
            onChange={(event) => update({ maxAdvanceDays: Number(event.target.value) })}
          />
          <Select
            label="Margen entre reservas"
            helperText="Tiempo libre para ordenar o preparar entre un cliente y otro."
            options={BUFFER_OPTIONS}
            value={String(draft.bufferMinutes)}
            onChange={(event) => update({ bufferMinutes: Number(event.target.value) })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={save} loading={saveMutation.isPending}>
            Guardar horario
          </Button>
          <div aria-live="polite" className="text-sm">
            {error ? (
              <p role="alert" className="text-danger">
                {error}
              </p>
            ) : saved ? (
              <p className="text-success">Horario guardado.</p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DayRow({ day, windows, onChange }: { day: Weekday; windows: WeeklyHours[Weekday]; onChange: (windows: WeeklyHours[Weekday]) => void }): React.JSX.Element {
  const open = windows.length > 0;
  const label = WEEKDAY_LABELS[day];

  function setWindow(index: number, field: "start" | "end", value: string): void {
    onChange(windows.map((window, i) => (i === index ? { ...window, [field]: value } : window)));
  }

  function addWindow(): void {
    // El tramo nuevo empieza donde termina el anterior y dura dos horas, sin pasar de medianoche.
    const lastEnd = windows.at(-1)?.end ?? "07:00";
    const startMinutes = Math.min(minutesOfDay(lastEnd), 22 * 60);
    onChange([...windows, { start: formatTime(startMinutes), end: formatTime(Math.min(startMinutes + 120, 24 * 60)) }]);
  }

  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:gap-4" data-day={day}>
      <label className="flex w-36 shrink-0 items-center gap-2 pt-2 text-sm font-medium text-foreground">
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-primary)]"
          checked={open}
          onChange={(event) => onChange(event.target.checked ? [{ start: "09:00", end: "18:00" }] : [])}
          aria-label={`${label} abierto`}
        />
        {label}
      </label>
      {open ? (
        <div className="flex flex-1 flex-col gap-2">
          {windows.map((window, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input
                type="time"
                step={300}
                value={window.start}
                onChange={(event) => setWindow(index, "start", event.target.value)}
                aria-label={`${label}, tramo ${index + 1}, desde`}
                className="h-10 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              />
              <span className="text-sm text-muted-foreground">a</span>
              <input
                type="time"
                step={300}
                value={window.end === "24:00" ? "23:59" : window.end}
                onChange={(event) => setWindow(index, "end", event.target.value === "23:59" ? "24:00" : event.target.value)}
                aria-label={`${label}, tramo ${index + 1}, hasta`}
                className="h-10 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(windows.filter((_, i) => i !== index))}
                aria-label={`Quitar el tramo ${index + 1} del ${label.toLowerCase()}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {windows.length < 4 ? (
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={addWindow}>
              <Plus className="size-4" aria-hidden="true" />
              Agregar tramo
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="pt-2 text-sm text-muted-foreground">Cerrado</p>
      )}
    </li>
  );
}
