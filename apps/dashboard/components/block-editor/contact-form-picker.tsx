"use client";

import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorState, LoadingState, Select } from "@impulza/ui";
import type { CreateFormFieldBody } from "../../lib/api/forms";
import { useCreateForm, useForms } from "../../lib/hooks/use-forms";
import { useUpdateBlock } from "../../lib/hooks/use-blocks";
import { getPlanLimitInfo } from "../../lib/plan-limit";
import { PlanLimitNotice } from "../plan-limit-notice";

const DEFAULT_FIELDS: CreateFormFieldBody[] = [
  { type: "TEXT", label: "Nombre", required: true },
  { type: "EMAIL", label: "Correo", required: true },
  { type: "TEXTAREA", label: "Mensaje", required: false },
  { type: "CONSENT", label: "Acepto que me contacten sobre esta consulta", required: false },
];

/**
 * Selector de `Form` real para el bloque `contact_form` (F3.2). No es un campo del motor
 * declarativo (`block-fields/`, F2.9 Etapa B1): ese motor solo sabe pintar controles sobre datos
 * ya presentes en el formulario de React Hook Form, y este selector necesita pedirle a la API la
 * lista de formularios del sitio y crear uno nuevo — por eso vive aparte y guarda con su propia
 * llamada a `PATCH .../blocks/:blockId`, igual que hace `BlockConfigPanel` para el resto de los
 * campos, pero sin pasar por el ciclo de autoguardado genérico (`normalizeBlockConfig` solo
 * conoce los campos declarados en `BLOCK_FIELD_SETS`, y `formId` no es uno de ellos a propósito).
 */
export function ContactFormPicker({
  organizationId,
  siteId,
  pageId,
  blockId,
  currentConfig,
  onSaved,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
  blockId: string;
  currentConfig: Record<string, unknown>;
  onSaved: (blockId: string, before: unknown, after: unknown) => void;
}) {
  const formsQuery = useForms(organizationId, siteId);
  const createFormMutation = useCreateForm(organizationId, siteId);
  const updateBlockMutation = useUpdateBlock(organizationId, siteId, pageId);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  const currentFormId = typeof currentConfig.formId === "string" ? currentConfig.formId : null;

  async function applyFormId(formId: string | null): Promise<void> {
    setStatus("saving");
    const nextConfig = { ...currentConfig, formId };
    try {
      await updateBlockMutation.mutateAsync({ blockId, changes: { config: nextConfig } });
      onSaved(blockId, currentConfig, nextConfig);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function handleQuickCreate(): Promise<void> {
    setStatus("saving");
    try {
      const created = await createFormMutation.mutateAsync({
        name: "Formulario de contacto",
        fields: DEFAULT_FIELDS,
      });
      await applyFormId(created.id);
    } catch {
      setStatus("error");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Formulario</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {formsQuery.isPending ? (
          <LoadingState label="Cargando formularios…" className="p-4" />
        ) : formsQuery.isError ? (
          <ErrorState
            description="No se pudieron cargar los formularios del sitio."
            onRetry={() => formsQuery.refetch()}
            className="p-4"
          />
        ) : (
          <>
            {formsQuery.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este sitio todavía no tiene formularios.</p>
            ) : (
              <Select
                label="Elegir uno existente"
                placeholder="— Sin elegir —"
                options={formsQuery.data.map((form) => ({ value: form.id, label: form.name }))}
                value={currentFormId ?? ""}
                onChange={(event) => void applyFormId(event.target.value.length > 0 ? event.target.value : null)}
              />
            )}

            <Button type="button" variant="secondary" size="sm" onClick={() => void handleQuickCreate()}>
              Crear formulario rápido (nombre, correo, mensaje y consentimiento)
            </Button>

            {status === "saving" ? <span className="text-sm text-muted-foreground">Guardando…</span> : null}
            {status === "error" && getPlanLimitInfo(createFormMutation.error) ? (
              // Límite de formularios del plan (F4.3): aviso con camino a Planes, no "reintenta".
              <PlanLimitNotice error={createFormMutation.error} />
            ) : status === "error" ? (
              <span role="alert" className="text-sm text-danger">
                No se pudo guardar. Intenta de nuevo.
              </span>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
