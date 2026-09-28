"use client";

import type { AdminAiConnectionResponse } from "@impulza/contracts";
import { Button, Dialog, Input, Select } from "@impulza/ui";
import { aiBaseUrlSchema, createAiConnectionSchema, updateAiConnectionSchema, type UpdateAiConnectionInput } from "@impulza/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { adminApi } from "../../lib/api";

const KIND_OPTIONS = [
  { value: "OPENAI_COMPATIBLE", label: "Compatible con OpenAI (servidor propio, OpenAI, Gemini, Groq…)" },
  { value: "ANTHROPIC", label: "Claude (Anthropic)" },
];

const JSON_MODE_OPTIONS = [
  { value: "json_schema", label: "Esquema estricto (recomendado)" },
  { value: "json_object", label: "Solo JSON válido" },
  { value: "prompt", label: "Solo instrucción" },
];

/** Ejemplos de URL para no tener que buscarlos. Van en una lista aparte: son largos y deben poder partirse. */
const URL_EXAMPLES = [
  ["Ollama", "http://IP:11434/v1"],
  ["vLLM", "http://IP:8000/v1"],
  ["OpenAI", "https://api.openai.com/v1"],
  ["Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"],
] as const;

/** "3" o "0,15" (US$ por millón de tokens) → micro-dólares enteros. `null` si no es un número válido. */
function parseUsd(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    return null;
  }
  return Math.round(Number(normalized) * 1_000_000);
}

function usdText(micro: number): string {
  return String(micro / 1_000_000).replace(".", ",");
}

interface Draft {
  name: string;
  kind: "OPENAI_COMPATIBLE" | "ANTHROPIC";
  baseUrl: string;
  model: string;
  apiKey: string;
  removeApiKey: boolean;
  jsonMode: "json_schema" | "json_object" | "prompt";
  timeoutSeconds: string;
  inputUsd: string;
  outputUsd: string;
  enabled: boolean;
}

function initialDraft(connection: AdminAiConnectionResponse | null): Draft {
  return {
    name: connection?.name ?? "",
    kind: connection?.kind ?? "OPENAI_COMPATIBLE",
    baseUrl: connection?.baseUrl ?? "",
    model: connection?.model ?? "",
    apiKey: "",
    removeApiKey: false,
    jsonMode: connection?.jsonMode ?? "json_schema",
    timeoutSeconds: String((connection?.timeoutMs ?? 30_000) / 1000),
    inputUsd: usdText(connection?.inputMicroUsdPerMTok ?? 0),
    outputUsd: usdText(connection?.outputMicroUsdPerMTok ?? 0),
    enabled: connection?.enabled ?? true,
  };
}

/**
 * Alta y edición de una conexión de IA (F6.2b). El token se escribe pero nunca se muestra: en la
 * edición, dejarlo vacío conserva el actual. Se valida con los mismos esquemas que usa el servidor.
 */
export function ConnectionFormDialog({
  open,
  onOpenChange,
  connection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = conexión nueva. */
  connection: AdminAiConnectionResponse | null;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(connection));
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const timeoutMs = /^\d+$/.test(draft.timeoutSeconds.trim()) ? Number(draft.timeoutSeconds) * 1000 : NaN;
  const inputMicro = parseUsd(draft.inputUsd);
  const outputMicro = parseUsd(draft.outputUsd);
  const needsUrl = draft.kind === "OPENAI_COMPATIBLE";
  const errors = {
    name: draft.name.trim().length < 2 ? "Al menos 2 caracteres." : undefined,
    baseUrl:
      needsUrl && draft.baseUrl.trim() === ""
        ? "Escribe la URL del servidor."
        : draft.baseUrl.trim() !== "" && !aiBaseUrlSchema.safeParse(draft.baseUrl).success
          ? "Usa una URL http(s) sin usuario, contraseña ni parámetros."
          : undefined,
    model: draft.model.trim() === "" ? "Escribe el nombre del modelo." : undefined,
    timeout: Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 300_000 ? undefined : "Entre 1 y 300 segundos.",
    inputUsd: inputMicro === null ? "Un número, por ejemplo 3 o 0,15." : undefined,
    outputUsd: outputMicro === null ? "Un número, por ejemplo 15 o 0,60." : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const mutation = useMutation({
    mutationFn: async () => {
      const fields = {
        name: draft.name.trim(),
        kind: draft.kind,
        baseUrl: draft.baseUrl.trim() === "" ? null : draft.baseUrl.trim(),
        model: draft.model.trim(),
        jsonMode: draft.jsonMode,
        timeoutMs,
        inputMicroUsdPerMTok: inputMicro ?? 0,
        outputMicroUsdPerMTok: outputMicro ?? 0,
        enabled: draft.enabled,
      };
      if (!connection) {
        return adminApi.createAiConnection(createAiConnectionSchema.parse({ ...fields, apiKey: draft.apiKey.trim() === "" ? null : draft.apiKey.trim() }));
      }
      const body: UpdateAiConnectionInput = {
        ...fields,
        ...(draft.removeApiKey ? { apiKey: null } : draft.apiKey.trim() !== "" ? { apiKey: draft.apiKey.trim() } : {}),
      };
      return adminApi.updateAiConnection(connection.id, updateAiConnectionSchema.parse(body));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "ai"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
      onOpenChange(false);
    },
  });

  const show = (error: string | undefined) => (touched ? error : undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={connection ? `Editar «${connection.name}»` : "Agregar conexión de IA"}
      description="El token se guarda cifrado y no se vuelve a mostrar. Solo la API habla con el proveedor: nunca el navegador."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="ai-connection-form" loading={mutation.isPending}>
            {connection ? "Guardar cambios" : "Agregar conexión"}
          </Button>
        </>
      }
    >
      <form
        id="ai-connection-form"
        aria-label={connection ? "Editar conexión de IA" : "Nueva conexión de IA"}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!hasErrors) {
            mutation.mutate();
          }
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Nombre" value={draft.name} onChange={(e) => set("name", e.target.value)} error={show(errors.name)} maxLength={60} helperText="Para reconocerla, p. ej. «Servidor propio — Qwen»." />
          <Select label="Tipo" options={KIND_OPTIONS} value={draft.kind} onChange={(e) => set("kind", e.target.value as Draft["kind"])} />
        </div>
        <Input
          label={needsUrl ? "URL del servidor" : "URL del servidor (opcional)"}
          value={draft.baseUrl}
          onChange={(e) => set("baseUrl", e.target.value)}
          error={show(errors.baseUrl)}
          placeholder={needsUrl ? "http://10.0.0.5:11434/v1" : "https://api.anthropic.com"}
          helperText={needsUrl ? undefined : "Déjala vacía para usar la API oficial de Anthropic."}
          inputMode="url"
          autoComplete="off"
        />
        {needsUrl ? (
          <ul className="-mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground" aria-label="Ejemplos de URL">
            {URL_EXAMPLES.map(([label, url]) => (
              <li key={label} className="break-all">
                <span className="font-medium text-foreground">{label}:</span> {url}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Modelo"
            value={draft.model}
            onChange={(e) => set("model", e.target.value)}
            error={show(errors.model)}
            placeholder={needsUrl ? "qwen2.5:14b" : "claude-opus-5"}
            autoComplete="off"
          />
          <Input
            label="Token de acceso"
            type="password"
            value={draft.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
            disabled={draft.removeApiKey}
            autoComplete="new-password"
            helperText={
              connection?.hasApiKey
                ? `Guardado (termina en ${connection.apiKeyHint}). Déjalo vacío para conservarlo.`
                : "Opcional para un servidor propio sin autenticación."
            }
          />
        </div>
        {connection?.hasApiKey ? (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={draft.removeApiKey} onChange={(e) => set("removeApiKey", e.target.checked)} />
            Quitar el token guardado
          </label>
        ) : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select
            label="Formato de respuesta"
            options={JSON_MODE_OPTIONS}
            value={draft.jsonMode}
            onChange={(e) => set("jsonMode", e.target.value as Draft["jsonMode"])}
            helperText={needsUrl ? "Si el servidor no soporta esquemas, usa «Solo JSON válido»." : "Claude siempre usa esquema estricto."}
            disabled={!needsUrl}
          />
          <Input
            label="Tiempo máximo (segundos)"
            inputMode="numeric"
            value={draft.timeoutSeconds}
            onChange={(e) => set("timeoutSeconds", e.target.value)}
            error={show(errors.timeout)}
            helperText="Un modelo local puede necesitar más."
          />
          <label className="flex items-center gap-2 self-center text-sm text-foreground sm:mt-6">
            <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            Activa
          </label>
        </div>
        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-foreground">Precio (US$ por millón de tokens, 0 para un modelo propio)</legend>
          <Input label="Entrada" inputMode="decimal" value={draft.inputUsd} onChange={(e) => set("inputUsd", e.target.value)} error={show(errors.inputUsd)} />
          <Input label="Salida" inputMode="decimal" value={draft.outputUsd} onChange={(e) => set("outputUsd", e.target.value)} error={show(errors.outputUsd)} />
        </fieldset>

        {mutation.isError ? (
          <p role="alert" className="text-sm text-danger">
            {mutation.error instanceof ApiError
              ? mutation.error.issues[0]
                ? `${mutation.error.issues[0].path}: ${mutation.error.issues[0].message}`
                : mutation.error.messageOr("No se pudo guardar la conexión.")
              : "No se pudo guardar la conexión."}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
