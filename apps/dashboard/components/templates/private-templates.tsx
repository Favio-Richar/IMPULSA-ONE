"use client";

import type { PrivateTemplateResponse, TemplateResponse } from "@impulza/contracts";
import { Button, Dialog, Input, Textarea } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, apiFetch } from "../../lib/api-client";
import { ConfirmButton } from "../confirm-button";

// Plantillas privadas (F9.7c, ADR-028): guardar una página como plantilla propia y elegirla después. El servidor decide qué plantillas
// ve cada quien (las propias y, con acceso delegado, las de la agencia); esta pantalla solo las muestra.

const key = (organizationId: string) => ["private-templates", organizationId] as const;

function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

export function usePrivateTemplates(organizationId: string) {
  return useQuery({
    queryKey: key(organizationId),
    queryFn: () => apiFetch<PrivateTemplateResponse[]>(`/organizations/${organizationId}/private-templates`),
  });
}

/** «Tus plantillas»: las propias y las de la agencia (marcadas). Sin ninguna, no ocupa lugar. */
export function PrivateTemplatesSection({
  organizationId,
  onUse,
}: {
  organizationId: string;
  onUse: (template: TemplateResponse) => void;
}): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const query = usePrivateTemplates(organizationId);
  const remove = useMutation({
    mutationFn: (templateId: string) => apiFetch<void>(`/organizations/${organizationId}/private-templates/${templateId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(organizationId) }),
  });

  if (query.isPending || query.isError || query.data.length === 0) return null;

  return (
    <section className="mb-6 flex flex-col gap-3" aria-label="Tus plantillas" data-testid="private-templates">
      <h3 className="text-sm font-semibold text-foreground">Tus plantillas</h3>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {query.data.map((template) => (
          <li key={template.id} className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="private-template" data-template-name={template.name}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{template.name}</span>
              {template.fromAgency ? (
                <span className="shrink-0 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-muted-foreground">De tu agencia</span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{template.description}</p>
            <div className="mt-auto flex items-center justify-between gap-2">
              <Button type="button" size="sm" onClick={() => onUse(template)}>
                Elegir
              </Button>
              {template.fromAgency ? null : (
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  confirmLabel="¿Borrar esta plantilla?"
                  loading={remove.isPending && remove.variables === template.id}
                  onConfirm={() => remove.mutate(template.id)}
                >
                  Borrar
                </ConfirmButton>
              )}
            </div>
          </li>
        ))}
      </ul>
      {remove.isError ? (
        <p role="alert" className="text-sm text-danger">
          {serverMessage(remove.error, "No pudimos borrar la plantilla.")}
        </p>
      ) : null}
    </section>
  );
}

/** «Guardar como plantilla»: la página actual pasa a ser una plantilla propia. */
export function SaveAsTemplateDialog({
  organizationId,
  siteId,
  pageId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [includeAppearance, setIncludeAppearance] = useState(true);
  const [done, setDone] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<PrivateTemplateResponse>(`/organizations/${organizationId}/private-templates`, {
        method: "POST",
        body: { name: name.trim(), description: description.trim(), siteId, pageId, includeAppearance },
      }),
    onSuccess: async (created) => {
      setDone(created.name);
      await queryClient.invalidateQueries({ queryKey: key(organizationId) });
    },
  });

  function close(): void {
    onOpenChange(false);
    // Se limpia al cerrar, no al abrir: la persona ve la confirmación hasta que cierra.
    setTimeout(() => {
      setName("");
      setDescription("");
      setDone(null);
      save.reset();
    }, 150);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Guardar como plantilla"
      description="Copia los bloques visibles de esta página para reutilizarlos. Solo tú (y tu agencia, si trabajas con una) la verás: nunca aparece en la galería pública."
      footer={
        done ? (
          <Button type="button" onClick={close}>
            Listo
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={close} disabled={save.isPending}>
              Cancelar
            </Button>
            <Button type="button" loading={save.isPending} disabled={name.trim().length < 2 || description.trim().length < 10} onClick={() => save.mutate()}>
              Guardar plantilla
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p role="status" className="text-sm text-success" data-testid="template-saved">
          Plantilla «{done}» guardada. La encontrarás en «Usar una plantilla».
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Input label="Nombre" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          <Textarea
            label="Para qué sirve"
            helperText="Mínimo 10 caracteres."
            maxLength={300}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <label className="flex items-start gap-3 text-sm text-foreground">
            <input type="checkbox" className="mt-1" checked={includeAppearance} onChange={(event) => setIncludeAppearance(event.target.checked)} />
            <span>Guardar también el tema y el fondo de este sitio (si son del catálogo).</span>
          </label>
          <p className="text-xs text-muted-foreground">Los formularios, servicios y productos de tu negocio no se copian: el bloque queda sin configurar.</p>
          {save.isError ? (
            <p role="alert" className="text-sm text-danger">
              {serverMessage(save.error, "No pudimos guardar la plantilla. Intenta de nuevo.")}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
