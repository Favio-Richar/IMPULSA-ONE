"use client";

import type { BookingBranchResponse } from "@impulza/contracts";
import {
  bookingBranchSchema,
  MAX_BRANCHES_PER_SITE,
  type BookingBranchInput,
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
} from "@impulza/ui";
import { MapPin, Pencil, Phone } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import {
  useBookingBranches,
  useCreateBookingBranch,
  useDeleteBookingBranch,
  useUpdateBookingBranch,
} from "../../lib/hooks/use-booking-setup";
import { ConfirmButton } from "../confirm-button";

interface BranchDraft {
  name: string;
  address: string;
  phone: string;
  active: boolean;
}

const EMPTY_DRAFT: BranchDraft = { name: "", address: "", phone: "", active: true };

function draftOf(branch: BookingBranchResponse): BranchDraft {
  return {
    name: branch.name,
    address: branch.address ?? "",
    phone: branch.phone ?? "",
    active: branch.active,
  };
}

function toInput(draft: BranchDraft): { input?: BookingBranchInput; error?: string } {
  const parsed = bookingBranchSchema.safeParse({
    name: draft.name.trim(),
    address: draft.address.trim() || undefined,
    phone: draft.phone.trim() || undefined,
    active: draft.active,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos de la sucursal." };
  }
  return { input: parsed.data };
}

/**
 * Gestión de sucursales del sitio (F7.9a).
 */
export function BookingBranches({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const branchesQuery = useBookingBranches(organizationId, siteId);

  if (branchesQuery.isPending) return <LoadingState label="Cargando sucursales…" />;
  if (branchesQuery.isError) return <ErrorState onRetry={() => branchesQuery.refetch()} />;

  const branches = branchesQuery.data;
  const full = branches.length >= MAX_BRANCHES_PER_SITE;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sucursales de atención</CardTitle>
        <CardDescription>
          Si atiendes en varios locales o consultorios, agrégalos acá. Tus clientes podrán elegir la sucursal al reservar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {branches.length === 0 ? (
          <EmptyState
            title="Una sola ubicación"
            description="Sin sucursales adicionales configuradas, las reservas se gestionan en tu ubicación central por defecto."
          />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface" aria-label="Sucursales">
            {branches.map((branch) => (
              <BranchRow key={branch.id} organizationId={organizationId} siteId={siteId} branch={branch} />
            ))}
          </ul>
        )}
        {full ? (
          <p className="text-sm text-muted-foreground">Llegaste al límite de {MAX_BRANCHES_PER_SITE} sucursales por sitio.</p>
        ) : (
          <NewBranchForm organizationId={organizationId} siteId={siteId} />
        )}
      </CardContent>
    </Card>
  );
}

function BranchRow({
  organizationId,
  siteId,
  branch,
}: {
  organizationId: string;
  siteId: string;
  branch: BookingBranchResponse;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const deleteMutation = useDeleteBookingBranch(organizationId, siteId);

  if (editing) {
    return (
      <li className="p-4">
        <EditBranchForm organizationId={organizationId} siteId={siteId} branch={branch} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4" data-branch={branch.name}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          {branch.name}
          {!branch.active ? <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-normal text-muted-foreground">Inactiva</span> : null}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {branch.address ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden="true" />
              {branch.address}
            </span>
          ) : null}
          {branch.phone ? (
            <span className="inline-flex items-center gap-1">
              <Phone className="size-3.5" aria-hidden="true" />
              {branch.phone}
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Editar ${branch.name}`}>
          <Pencil className="size-4" aria-hidden="true" />
          Editar
        </Button>
        <ConfirmButton
          variant="ghost"
          size="sm"
          confirmLabel="¿Borrar sucursal?"
          loading={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(branch.id)}
        >
          Borrar
        </ConfirmButton>
      </div>
    </li>
  );
}

function NewBranchForm({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const createMutation = useCreateBookingBranch(organizationId, siteId);
  return (
    <BranchForm
      key="new"
      title="Agregar sucursal"
      initial={EMPTY_DRAFT}
      submitLabel="Agregar sucursal"
      pending={createMutation.isPending}
      onSubmit={async (input) => {
        await createMutation.mutateAsync(input);
      }}
      resetOnSuccess
    />
  );
}

function EditBranchForm({
  organizationId,
  siteId,
  branch,
  onDone,
}: {
  organizationId: string;
  siteId: string;
  branch: BookingBranchResponse;
  onDone: () => void;
}): React.JSX.Element {
  const updateMutation = useUpdateBookingBranch(organizationId, siteId);
  return (
    <BranchForm
      key={branch.id}
      title={`Editar ${branch.name}`}
      initial={draftOf(branch)}
      submitLabel="Guardar cambios"
      pending={updateMutation.isPending}
      onCancel={onDone}
      onSubmit={async (input) => {
        await updateMutation.mutateAsync({ branchId: branch.id, changes: input });
        onDone();
      }}
    />
  );
}

function BranchForm({
  title,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  resetOnSuccess,
}: {
  title: string;
  initial: BranchDraft;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: BookingBranchInput) => Promise<void>;
  onCancel?: () => void;
  resetOnSuccess?: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const { input, error: validationError } = toInput(draft);
    if (validationError || !input) {
      setError(validationError ?? "Revisa los campos.");
      return;
    }
    setError(null);
    try {
      await onSubmit(input);
      if (resetOnSuccess) setDraft(EMPTY_DRAFT);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError("No se puede eliminar o modificar esta sucursal porque tiene reservas activas asociadas.");
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError("No se pudo guardar la sucursal. Intenta de nuevo.");
      }
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={title} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nombre de la sucursal"
          placeholder="Ej. Sucursal Providencia"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          required
        />
        <Input
          label="Dirección"
          placeholder="Ej. Av. Providencia 1234, Of. 501"
          value={draft.address}
          onChange={(e) => setDraft({ ...draft, address: e.target.value })}
        />
        <Input
          label="Teléfono de contacto"
          placeholder="+56 9 1234 5678"
          value={draft.phone}
          onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
        />
        <div className="flex items-center gap-2 pt-6">
          <input
            type="checkbox"
            id={`active-${title}`}
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            className="size-4 rounded border-border"
          />
          <label htmlFor={`active-${title}`} className="text-sm text-foreground">
            Sucursal activa para recibir reservas
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
