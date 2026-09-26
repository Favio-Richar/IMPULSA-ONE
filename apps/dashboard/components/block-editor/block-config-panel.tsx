"use client";

import { BLOCK_CATALOG, isBlockType, isPrimaryActionBlockType, type BlockType } from "@impulza/validation";
import type { BlockResponse } from "@impulza/contracts";
import { Button } from "@impulza/ui";
import { useEffect, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { BLOCK_FIELD_SETS } from "../../lib/block-fields/catalog";
import { FieldGroup } from "../../lib/block-fields/field-renderer";
import { BLOCK_LABELS } from "../../lib/block-fields/labels";
import { createBlockConfigResolver } from "../../lib/block-fields/resolver";
import { sameConfig } from "../../lib/block-fields/same-config";
import { toFormConfig } from "../../lib/block-fields/to-form-value";
import { useUpdateBlock } from "../../lib/hooks/use-blocks";
import { ContactFormPicker } from "./contact-form-picker";
import { PrimaryActionToggle } from "./primary-action-toggle";

const AUTOSAVE_DELAY_MS = 800;

type SaveStatus = "idle" | "saving" | "saved" | "error" | "invalid";

/**
 * Panel de configuración del bloque seleccionado en el lienzo: un formulario por tipo, generado
 * desde `BLOCK_FIELD_SETS` (F2.9 Etapa B1), con guardado automático — el usuario nunca aprieta
 * "guardar" acá, la única acción explícita del constructor es "Publicar" (en la pantalla de la
 * página, F2.6), que es justo la distinción que pide el criterio de aceptación de F2.9.
 *
 * El resolver (`createBlockConfigResolver`) es el mismo schema Zod del catálogo, no una copia —
 * cuando algo no valida, el motivo real aparece junto al campo (`formState.errors`, leído por
 * `field-renderer.tsx`) en vez de quedarse sin guardar en silencio.
 */
export function BlockConfigPanel({
  organizationId,
  siteId,
  pageId,
  block,
  onClose,
  onSaved,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
  block: BlockResponse;
  onClose: () => void;
  /** Cada guardado exitoso, para el historial de deshacer/rehacer del constructor (F2.9) —
   *  `before` es el valor con el que arrancó la sesión de edición de este bloque (o el último
   *  valor externo, si deshacer/rehacer lo cambió mientras seguía seleccionado). */
  onSaved: (blockId: string, before: unknown, after: unknown) => void;
}) {
  const type: BlockType | null = isBlockType(block.type) ? block.type : null;
  const fieldSet = type ? BLOCK_FIELD_SETS[type] : undefined;
  const definition = type ? BLOCK_CATALOG[type] : undefined;
  const updateMutation = useUpdateBlock(organizationId, siteId, pageId);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openingConfigRef = useRef<unknown>(block.config);
  const lastPersistedRef = useRef<unknown>(block.config);

  const methods = useForm({
    defaultValues: toFormConfig(block.config, fieldSet?.fields ?? []),
    resolver: fieldSet && definition ? createBlockConfigResolver(definition.schema, fieldSet.fields) : undefined,
  });
  const { watch, reset, handleSubmit } = methods;

  // Nuevo formulario al cambiar de bloque seleccionado, no en cada tecleo — `block.id` es la única
  // dependencia real; `block.config` cambia con cada autoguardado propio y no debe reiniciar el
  // formulario que el usuario está editando en ese momento.
  useEffect(() => {
    openingConfigRef.current = block.config;
    lastPersistedRef.current = block.config;
    reset(toFormConfig(block.config, fieldSet?.fields ?? []));
    setStatus("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  // Mismo bloque, pero su config cambió por algo externo a este panel (deshacer/rehacer) — el
  // eco del propio autoguardado de este panel ya coincide con `lastPersistedRef` y no dispara
  // nada acá. Sincroniza el formulario con lo que hay ahora en el servidor, para que la próxima
  // tecla no reescriba encima de lo que acaba de deshacerse.
  useEffect(() => {
    if (sameConfig(block.config, lastPersistedRef.current)) {
      return;
    }
    openingConfigRef.current = block.config;
    lastPersistedRef.current = block.config;
    reset(toFormConfig(block.config, fieldSet?.fields ?? []));
    setStatus("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.config]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [block.id]);

  async function persist(data: Record<string, unknown>): Promise<void> {
    setStatus("saving");
    try {
      await updateMutation.mutateAsync({ blockId: block.id, changes: { config: data } });
      lastPersistedRef.current = data;
      setStatus("saved");
      onSaved(block.id, openingConfigRef.current, data);
    } catch {
      setStatus("error");
    }
  }

  function markInvalid(): void {
    // El resolver ya dejó el motivo puntual en `formState.errors`, junto a cada campo — este
    // estado es solo el resumen general para el indicador de arriba.
    setStatus("invalid");
  }

  const submit = () => handleSubmit(persist, markInvalid)();

  useEffect(() => {
    const subscription = watch((_value, { type: eventType }) => {
      // `reset()` (deshacer/rehacer externo, o el cambio de bloque) también notifica a `watch` —
      // sin `type` real de evento, a diferencia de una tecla u otra interacción real del usuario.
      // Autoguardar ahí reenviaría al servidor exactamente lo que acaba de llegar de él, en el
      // mejor caso una vuelta redundante y en el peor una carrera con el propio `reset()`.
      if (eventType !== "change") {
        return;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        void submit();
      }, AUTOSAVE_DELAY_MS);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch, block.id]);

  if (!type || !fieldSet || !definition) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          El bloque de tipo «{block.type}» todavía no tiene un panel de edición en el constructor.
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    );
  }

  return (
    <FormProvider {...methods}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">{BLOCK_LABELS[type]}</p>
            <SaveStatusIndicator status={status} onRetry={() => void submit()} />
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
        {isPrimaryActionBlockType(type) ? (
          <PrimaryActionToggle organizationId={organizationId} siteId={siteId} pageId={pageId} block={block} />
        ) : null}
        <form className="flex flex-col gap-4" onSubmit={(event) => event.preventDefault()}>
          <FieldGroup fields={fieldSet.fields} />
          {type === "contact_form" ? (
            <ContactFormPicker
              organizationId={organizationId}
              siteId={siteId}
              pageId={pageId}
              blockId={block.id}
              currentConfig={block.config as Record<string, unknown>}
              onSaved={onSaved}
            />
          ) : null}
        </form>
      </div>
    </FormProvider>
  );
}

function SaveStatusIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === "saving") {
    return <span className="text-sm text-muted-foreground">Guardando…</span>;
  }
  if (status === "saved") {
    return <span className="text-sm text-success">Guardado</span>;
  }
  if (status === "invalid") {
    return <span className="text-sm text-muted-foreground">Revisa los campos marcados abajo</span>;
  }
  if (status === "error") {
    return (
      <span role="alert" className="flex items-center gap-2 text-sm text-danger">
        No se pudo guardar.
        <button type="button" className="underline" onClick={onRetry}>
          Reintentar
        </button>
      </span>
    );
  }
  return <span className="text-sm text-muted-foreground">Sin cambios</span>;
}
