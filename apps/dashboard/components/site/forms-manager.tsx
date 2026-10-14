"use client";

import type { FormFieldResponse, FormResponse } from "@impulza/contracts";
import { createFormFieldSchema, successActionSchema } from "@impulza/validation";
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
import { ArrowDown, ArrowUp, ClipboardList, Download, Inbox, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  useCreateForm,
  useDeleteForm,
  useFormFieldActions,
  useFormSubmissions,
  useForms,
  useUpdateForm,
} from "../../lib/hooks/use-forms";
import { getPlanLimitInfo } from "../../lib/plan-limit";
import { ConfirmButton } from "../confirm-button";
import { PlanLimitNotice } from "../plan-limit-notice";

const FORM_TYPE_OPTIONS = [
  { value: "CONTACT", label: "Contacto" },
  { value: "QUOTE", label: "Cotización" },
  { value: "REGISTRATION", label: "Inscripción" },
  { value: "SURVEY", label: "Encuesta" },
  { value: "ORDER", label: "Pedido" },
] as const;

const FIELD_TYPE_OPTIONS = [
  { value: "TEXT", label: "Texto corto" },
  { value: "TEXTAREA", label: "Texto largo" },
  { value: "EMAIL", label: "Correo" },
  { value: "PHONE", label: "Teléfono" },
  { value: "NUMBER", label: "Número" },
  { value: "SELECT", label: "Lista de opciones" },
  { value: "CHECKBOX", label: "Casilla" },
  { value: "CONSENT", label: "Consentimiento" },
] as const;

const FIELD_TYPE_LABEL: Record<string, string> = Object.fromEntries(FIELD_TYPE_OPTIONS.map((option) => [option.value, option.label]));
const FORM_TYPE_LABEL: Record<string, string> = Object.fromEntries(FORM_TYPE_OPTIONS.map((option) => [option.value, option.label]));
const PAGE_SIZE = 25;

const DEFAULT_FIELDS = [
  { type: "TEXT", label: "Nombre", required: true },
  { type: "EMAIL", label: "Correo", required: true },
  { type: "TEXTAREA", label: "Mensaje", required: false },
] as const;

/**
 * Gestor de formularios del sitio: crear, configurar el mensaje de éxito, administrar campos (agregar, renombrar, marcar
 * obligatorios, reordenar, borrar) y ver los envíos recibidos. Usa la API de formularios (F3.2) y la lista de envíos.
 */
export function FormsManager({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const formsQuery = useForms(organizationId, siteId);
  const createMutation = useCreateForm(organizationId, siteId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<(typeof FORM_TYPE_OPTIONS)[number]["value"]>("CONTACT");

  if (formsQuery.isPending) {
    return <LoadingState label="Cargando formularios…" />;
  }
  if (formsQuery.isError) {
    return <ErrorState title="No pudimos cargar los formularios" onRetry={() => void formsQuery.refetch()} />;
  }

  const forms = formsQuery.data;
  const selected = forms.find((form) => form.id === selectedId) ?? forms[0] ?? null;
  const nameTrimmed = newName.trim();

  async function create(): Promise<void> {
    if (!nameTrimmed) {
      return;
    }
    const created = await createMutation.mutateAsync({ name: nameTrimmed, type: newType, fields: [...DEFAULT_FIELDS] });
    setNewName("");
    setSelectedId(created.id);
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-4" aria-hidden="true" />
            Formularios
          </CardTitle>
          <CardDescription>Los usas en el bloque «Formulario de contacto» de cualquier página.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {forms.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no tienes formularios. Crea el primero abajo.</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Formularios del sitio">
              {forms.map((form) => (
                <li key={form.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(form.id)}
                    aria-pressed={selected?.id === form.id}
                    className={`flex min-h-11 w-full flex-col items-start rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
                      selected?.id === form.id ? "border-primary bg-primary/5" : "border-border hover:bg-surface"
                    }`}
                  >
                    <span className="font-medium text-foreground">{form.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {FORM_TYPE_LABEL[form.type] ?? form.type} · {form.fields.length} campo(s)
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="flex flex-col gap-3 border-t border-border pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void create().catch(() => undefined);
            }}
          >
            <Input label="Nombre del formulario nuevo" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={160} />
            <Select
              label="Tipo"
              options={FORM_TYPE_OPTIONS}
              value={newType}
              onChange={(event) => setNewType(event.target.value as typeof newType)}
            />
            <Button type="submit" loading={createMutation.isPending} disabled={!nameTrimmed}>
              <Plus className="size-4" aria-hidden="true" />
              Crear formulario
            </Button>
            <PlanLimitNotice error={createMutation.error} />
            {createMutation.isError && !getPlanLimitInfo(createMutation.error) ? (
              <p role="alert" className="text-sm text-danger">
                No pudimos crear el formulario. Intenta de nuevo.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {selected ? (
        <FormDetail key={selected.id} organizationId={organizationId} siteId={siteId} form={selected} onDeleted={() => setSelectedId(null)} />
      ) : (
        <EmptyState
          title="Crea tu primer formulario"
          description="Recibe consultas, cotizaciones o inscripciones. Cada envío queda aquí y en tus Contactos."
        />
      )}
    </div>
  );
}

function FormDetail({
  organizationId,
  siteId,
  form,
  onDeleted,
}: {
  organizationId: string;
  siteId: string;
  form: FormResponse;
  onDeleted: () => void;
}): React.JSX.Element {
  const updateMutation = useUpdateForm(organizationId, siteId);
  const deleteMutation = useDeleteForm(organizationId, siteId);
  const [name, setName] = useState(form.name);
  const [type, setType] = useState<string>(form.type);
  const [message, setMessage] = useState(form.successAction.message);
  const [redirectUrl, setRedirectUrl] = useState(form.successAction.redirectUrl ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setFormError(null);
    const success = successActionSchema.safeParse({ message: message.trim(), ...(redirectUrl.trim() ? { redirectUrl: redirectUrl.trim() } : {}) });
    if (!success.success) {
      setFormError(success.error.issues[0]?.message ?? "Revisa el mensaje o la dirección de redirección.");
      return;
    }
    if (!name.trim()) {
      setFormError("El formulario necesita un nombre.");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        formId: form.id,
        body: { name: name.trim(), type: type as FormResponse["type"], successAction: success.data },
      });
    } catch {
      setFormError("No pudimos guardar los cambios. Intenta de nuevo.");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Configuración</CardTitle>
          <CardDescription>Nombre, tipo y qué ve la persona después de enviar.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nombre" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} />
            <Select label="Tipo" options={FORM_TYPE_OPTIONS} value={type} onChange={(event) => setType(event.target.value)} />
          </div>
          <Input
            label="Mensaje al enviar"
            helperText="Texto simple. Lo ve la persona al enviar el formulario."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={300}
          />
          <Input
            label="Redirigir a (opcional)"
            helperText="Una dirección https://… a la que llevar a la persona tras enviar."
            inputMode="url"
            value={redirectUrl}
            onChange={(event) => setRedirectUrl(event.target.value)}
          />
          {formError ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
          {updateMutation.isSuccess && !formError ? (
            <p role="status" className="text-sm text-success">
              Cambios guardados.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button onClick={() => void save()} loading={updateMutation.isPending}>
              Guardar cambios
            </Button>
            <ConfirmButton
              variant="ghost"
              confirmLabel="¿Borrar el formulario y todos sus envíos? No se puede deshacer."
              loading={deleteMutation.isPending}
              onConfirm={() => deleteMutation.mutate(form.id, { onSuccess: onDeleted })}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Borrar formulario
            </ConfirmButton>
          </div>
          {deleteMutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              No pudimos borrar el formulario. Intenta de nuevo.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <FieldsEditor organizationId={organizationId} siteId={siteId} form={form} />
      <SubmissionsPanel organizationId={organizationId} siteId={siteId} form={form} />
    </div>
  );
}

function FieldsEditor({ organizationId, siteId, form }: { organizationId: string; siteId: string; form: FormResponse }): React.JSX.Element {
  const actions = useFormFieldActions(organizationId, siteId);
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<string>("TEXT");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(): Promise<void> {
    setError(null);
    const candidate = {
      type: fieldType,
      label: label.trim(),
      required,
      ...(fieldType === "SELECT" ? { options: options.split(",").map((option) => option.trim()).filter(Boolean) } : {}),
    };
    const parsed = createFormFieldSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisa el campo.");
      return;
    }
    try {
      await actions.add.mutateAsync({ formId: form.id, body: parsed.data });
      setLabel("");
      setOptions("");
      setRequired(false);
    } catch {
      setError("No pudimos agregar el campo. Intenta de nuevo.");
    }
  }

  const ordered = [...form.fields].sort((a, b) => a.position - b.position);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campos</CardTitle>
        <CardDescription>Lo que se le pide a quien completa el formulario. Puedes cambiar el orden.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este formulario no tiene campos todavía. Agrega el primero abajo.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Campos del formulario">
            {ordered.map((field, index) => (
              <FieldRow
                key={field.id}
                field={field}
                isFirst={index === 0}
                isLast={index === ordered.length - 1}
                busy={actions.update.isPending || actions.remove.isPending}
                onRename={(nextLabel) => actions.update.mutate({ formId: form.id, fieldId: field.id, body: { label: nextLabel } })}
                onToggleRequired={() => actions.update.mutate({ formId: form.id, fieldId: field.id, body: { required: !field.required } })}
                onMove={(delta) => actions.update.mutate({ formId: form.id, fieldId: field.id, body: { position: field.position + delta } })}
                onRemove={() => actions.remove.mutate({ formId: form.id, fieldId: field.id })}
              />
            ))}
          </ul>
        )}
        {actions.update.isError || actions.remove.isError ? (
          <p role="alert" className="text-sm text-danger">
            No pudimos aplicar el cambio al campo. Intenta de nuevo.
          </p>
        ) : null}

        <form
          className="flex flex-col gap-3 rounded-lg border border-dashed border-border-strong p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <p className="text-sm font-medium text-foreground">Agregar un campo</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Etiqueta del campo" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={160} />
            <Select label="Tipo de campo" options={FIELD_TYPE_OPTIONS} value={fieldType} onChange={(event) => setFieldType(event.target.value)} />
          </div>
          {fieldType === "SELECT" ? (
            <Input
              label="Opciones"
              helperText="Sepáralas con comas. Por ejemplo: Corte, Color, Peinado"
              value={options}
              onChange={(event) => setOptions(event.target.value)}
            />
          ) : null}
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" className="size-4" checked={required} onChange={(event) => setRequired(event.target.checked)} />
            Obligatorio
          </label>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div>
            <Button type="submit" loading={actions.add.isPending} disabled={!label.trim()}>
              <Plus className="size-4" aria-hidden="true" />
              Agregar campo
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FieldRow({
  field,
  isFirst,
  isLast,
  busy,
  onRename,
  onToggleRequired,
  onMove,
  onRemove,
}: {
  field: FormFieldResponse;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onRename: (label: string) => void;
  onToggleRequired: () => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const [label, setLabel] = useState(field.label);
  const dirty = label.trim() !== field.label && label.trim() !== "";

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <Input
          label={`Etiqueta (${FIELD_TYPE_LABEL[field.type] ?? field.type})`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={160}
          helperText={field.type === "SELECT" && field.options ? `Opciones: ${field.options.join(", ")}` : undefined}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
        <input type="checkbox" className="size-4" checked={field.required} disabled={busy} onChange={onToggleRequired} />
        Obligatorio
      </label>
      <div className="flex flex-wrap items-center gap-1">
        {dirty ? (
          <Button size="sm" disabled={busy} onClick={() => onRename(label.trim())}>
            Guardar
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" aria-label={`Subir «${field.label}»`} disabled={busy || isFirst} onClick={() => onMove(-1)}>
          <ArrowUp className="size-4" aria-hidden="true" />
        </Button>
        <Button size="sm" variant="ghost" aria-label={`Bajar «${field.label}»`} disabled={busy || isLast} onClick={() => onMove(1)}>
          <ArrowDown className="size-4" aria-hidden="true" />
        </Button>
        <ConfirmButton size="sm" variant="ghost" confirmLabel="¿Borrar el campo?" onConfirm={onRemove} disabled={busy} aria-label={`Borrar «${field.label}»`}>
          <Trash2 className="size-4" aria-hidden="true" />
        </ConfirmButton>
      </div>
    </li>
  );
}

function formatValue(value: unknown): string {
  if (value === true) return "Sí";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function csvCell(value: string): string {
  // Evita la inyección de fórmulas al abrir el CSV en una hoja de cálculo.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function SubmissionsPanel({ organizationId, siteId, form }: { organizationId: string; siteId: string; form: FormResponse }): React.JSX.Element {
  const [offset, setOffset] = useState(0);
  const query = useFormSubmissions(organizationId, siteId, form.id, offset, PAGE_SIZE);
  const fields = [...form.fields].sort((a, b) => a.position - b.position);

  function exportPage(): void {
    if (!query.data) {
      return;
    }
    const header = ["Fecha", ...fields.map((field) => field.label)];
    const rows = query.data.items.map((item) => [
      new Date(item.createdAt).toLocaleString("es-CL"),
      ...fields.map((field) => formatValue(item.payload[field.id])),
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `envios-${form.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Inbox className="size-4" aria-hidden="true" />
          Envíos recibidos
        </CardTitle>
        <CardDescription>Del más reciente al más antiguo. Cada envío con correo o teléfono también crea un contacto.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isPending ? <LoadingState label="Cargando envíos…" /> : null}
        {query.isError ? <ErrorState title="No pudimos cargar los envíos" onRetry={() => void query.refetch()} /> : null}
        {query.data && query.data.total === 0 ? (
          <EmptyState
            title="Aún no hay envíos"
            description="Cuando alguien complete este formulario en tu página, lo verás aquí."
          />
        ) : null}
        {query.data && query.data.total > 0 ? (
          <>
            <div className="overflow-x-auto rounded-lg border border-border" role="region" aria-label="Envíos del formulario" tabIndex={0}>
              <table className="w-full border-collapse text-sm">
                <thead className="bg-surface">
                  <tr>
                    <th scope="col" className="h-10 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Fecha
                    </th>
                    {fields.map((field) => (
                      <th key={field.id} scope="col" className="h-10 px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {field.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {query.data.items.map((item) => (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap px-3 py-2">{new Date(item.createdAt).toLocaleString("es-CL")}</td>
                      {fields.map((field) => (
                        <td key={field.id} className="px-3 py-2">
                          {formatValue(item.payload[field.id])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, query.data.total)} de {query.data.total}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={exportPage}>
                  <Download className="size-4" aria-hidden="true" />
                  Descargar esta página (CSV)
                </Button>
                <Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Anteriores
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= query.data.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Siguientes
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
