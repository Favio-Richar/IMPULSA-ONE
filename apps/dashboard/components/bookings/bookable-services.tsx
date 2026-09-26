"use client";

import type { BookableServiceResponse } from "@impulza/contracts";
import { bookableServiceSchema, currencyFractionDigits, MAX_SERVICES_PER_SITE, type BookableServiceInput } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Input, LoadingState, Select } from "@impulza/ui";
import { Clock, Pencil } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import {
  useBookableServices,
  useCreateBookableService,
  useDeleteBookableService,
  useUpdateBookableService,
} from "../../lib/hooks/use-booking-setup";
import { ConfirmButton } from "../confirm-button";

const DURATIONS = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240].map((minutes) => ({ value: String(minutes), label: durationLabel(minutes) }));
const CURRENCIES = ["CLP", "USD", "ARS", "PEN", "COP", "MXN", "UYU", "EUR"].map((code) => ({ value: code, label: code }));

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Mismo formato que la página pública (`formatPrice`): el monto está en la unidad mínima. */
export function priceLabel(amount: number | null, currency: string | null): string | null {
  if (amount === null || !currency) return null;
  return new Intl.NumberFormat("es-CL", { style: "currency", currency }).format(amount / 10 ** currencyFractionDigits(currency));
}

/** Formulario del servicio: textos tal como los escribe la persona; se convierten al guardar. */
interface ServiceDraft {
  name: string;
  description: string;
  durationMinutes: string;
  price: string;
  priceCurrency: string;
  paymentUrl: string;
  active: boolean;
}

const EMPTY_DRAFT: ServiceDraft = { name: "", description: "", durationMinutes: "30", price: "", priceCurrency: "CLP", paymentUrl: "", active: true };

function draftOf(service: BookableServiceResponse): ServiceDraft {
  return {
    name: service.name,
    description: service.description ?? "",
    durationMinutes: String(service.durationMinutes),
    price: service.priceAmount === null || !service.priceCurrency ? "" : String(service.priceAmount / 10 ** currencyFractionDigits(service.priceCurrency)),
    priceCurrency: service.priceCurrency ?? "CLP",
    paymentUrl: service.paymentUrl ?? "",
    active: service.active,
  };
}

/**
 * Precio en la unidad mínima de la moneda (ISO 4217): pesos chilenos sin decimales, dólares en
 * centavos. Acepta "12.000" o "12000" para CLP y "19,90" o "19.90" para monedas con decimales.
 */
function toInput(draft: ServiceDraft): { input?: BookableServiceInput; error?: string } {
  const digits = currencyFractionDigits(draft.priceCurrency);
  const raw = draft.price.trim();
  const normalized = digits === 0 ? raw.replace(/[.,\s]/g, "") : raw.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const amount = normalized === "" ? undefined : Math.round(Number(normalized) * 10 ** digits);
  if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
    return { error: "El precio tiene que ser un número." };
  }
  const result = bookableServiceSchema.safeParse({
    name: draft.name,
    description: draft.description.trim() === "" ? undefined : draft.description,
    durationMinutes: Number(draft.durationMinutes),
    priceAmount: amount,
    priceCurrency: amount === undefined ? undefined : draft.priceCurrency,
    paymentUrl: draft.paymentUrl.trim() === "" ? undefined : draft.paymentUrl.trim(),
    active: draft.active,
  });
  return result.success ? { input: result.data } : { error: result.error.issues[0]?.message ?? "Revisa los datos." };
}

export function BookableServices({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const servicesQuery = useBookableServices(organizationId, siteId);
  const full = (servicesQuery.data?.length ?? 0) >= MAX_SERVICES_PER_SITE;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Servicios que se pueden reservar</CardTitle>
        <CardDescription>
          Cada servicio tiene su duración. Si cobras por adelantado, pega tu enlace de pago (Mercado Pago, Flow u otro): Impulza no
          cobra, solo lo muestra al confirmar la reserva.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {servicesQuery.isPending ? (
          <LoadingState label="Cargando servicios…" />
        ) : servicesQuery.isError ? (
          <ErrorState onRetry={() => servicesQuery.refetch()} />
        ) : servicesQuery.data.length === 0 ? (
          <EmptyState title="Todavía no hay servicios" description="Agrega el primero con el formulario de abajo." />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" aria-label="Servicios reservables">
            {servicesQuery.data.map((service) => (
              <ServiceRow key={service.id} organizationId={organizationId} siteId={siteId} service={service} />
            ))}
          </ul>
        )}
        {full ? (
          <p className="text-sm text-muted-foreground">Llegaste al máximo de {MAX_SERVICES_PER_SITE} servicios por sitio.</p>
        ) : (
          <NewServiceForm organizationId={organizationId} siteId={siteId} />
        )}
      </CardContent>
    </Card>
  );
}

function ServiceRow({ organizationId, siteId, service }: { organizationId: string; siteId: string; service: BookableServiceResponse }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const deleteMutation = useDeleteBookableService(organizationId, siteId);
  const price = priceLabel(service.priceAmount, service.priceCurrency);

  if (editing) {
    return (
      <li className="p-4">
        <EditServiceForm organizationId={organizationId} siteId={siteId} service={service} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4" data-service={service.name}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          {service.name}
          {!service.active ? <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-normal text-muted-foreground">Pausado</span> : null}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden="true" />
            {durationLabel(service.durationMinutes)}
          </span>
          {price ? <span>{price}</span> : null}
          {service.paymentUrl ? <span>Con enlace de pago</span> : null}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Editar ${service.name}`}>
          <Pencil className="size-4" aria-hidden="true" />
          Editar
        </Button>
        <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Borrar?" loading={deleteMutation.isPending} onConfirm={() => deleteMutation.mutate(service.id)}>
          Borrar
        </ConfirmButton>
      </div>
    </li>
  );
}

function NewServiceForm({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const createMutation = useCreateBookableService(organizationId, siteId);
  return (
    <ServiceForm
      key="new"
      title="Agregar servicio"
      initial={EMPTY_DRAFT}
      submitLabel="Agregar servicio"
      pending={createMutation.isPending}
      onSubmit={async (input) => {
        await createMutation.mutateAsync(input);
      }}
      resetOnSuccess
    />
  );
}

function EditServiceForm({
  organizationId,
  siteId,
  service,
  onDone,
}: {
  organizationId: string;
  siteId: string;
  service: BookableServiceResponse;
  onDone: () => void;
}): React.JSX.Element {
  const updateMutation = useUpdateBookableService(organizationId, siteId);
  return (
    <ServiceForm
      title={`Editar ${service.name}`}
      initial={draftOf(service)}
      submitLabel="Guardar cambios"
      pending={updateMutation.isPending}
      onCancel={onDone}
      onSubmit={async (input) => {
        await updateMutation.mutateAsync({
          serviceId: service.id,
          changes: {
            name: input.name,
            description: input.description ?? null,
            durationMinutes: input.durationMinutes,
            priceAmount: input.priceAmount ?? null,
            priceCurrency: input.priceCurrency ?? null,
            paymentUrl: input.paymentUrl ?? null,
            active: input.active,
          },
        });
        onDone();
      }}
    />
  );
}

function ServiceForm({
  title,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  resetOnSuccess = false,
}: {
  title: string;
  initial: ServiceDraft;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: BookableServiceInput) => Promise<void>;
  onCancel?: () => void;
  resetOnSuccess?: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ServiceDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (changes: Partial<ServiceDraft>) => setDraft((current) => ({ ...current, ...changes }));

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const { input, error: problem } = toInput(draft);
    setError(problem ?? null);
    if (!input) return;
    try {
      await onSubmit(input);
      if (resetOnSuccess) setDraft(EMPTY_DRAFT);
    } catch (caught) {
      const body = caught instanceof ApiError ? (caught.body as { message?: unknown } | undefined) : undefined;
      setError(typeof body?.message === "string" ? body.message : "No se pudo guardar. Intenta de nuevo.");
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={title} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Nombre" placeholder="Corte de pelo" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required />
        <Select label="Duración" options={DURATIONS} value={draft.durationMinutes} onChange={(e) => set({ durationMinutes: e.target.value })} />
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
          <Input label="Precio (opcional)" inputMode="decimal" placeholder="12.000" value={draft.price} onChange={(e) => set({ price: e.target.value })} />
          <Select label="Moneda" options={CURRENCIES} value={draft.priceCurrency} onChange={(e) => set({ priceCurrency: e.target.value })} />
        </div>
        <Input
          label="Enlace de pago (opcional)"
          type="url"
          placeholder="https://link.mercadopago.cl/…"
          value={draft.paymentUrl}
          onChange={(e) => set({ paymentUrl: e.target.value })}
        />
        <div className="sm:col-span-2">
          <Input
            label="Descripción (opcional)"
            placeholder="Qué incluye, qué traer…"
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            maxLength={500}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
        Disponible para reservar
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
