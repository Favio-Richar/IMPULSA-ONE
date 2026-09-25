"use client";

import { Button, cn } from "@impulza/ui";
import { mediaSrcSet } from "@impulza/validation";
import { ImagePlus, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useController, useFormContext } from "react-hook-form";
import { useActiveOrgStore } from "../../lib/active-org-store";
import { MediaPicker } from "../media/media-picker";

const inputClass =
  "h-10 rounded-md border border-border-strong bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";

const ASPECT_HINT: Record<"square" | "wide", string> = {
  square: "cuadrada, al menos 400 × 400 px",
  wide: "horizontal 16:9, al menos 1600 × 900 px",
};

/**
 * Control de imagen del editor de bloques (PP2): elegir de la biblioteca o subir en el momento, con
 * vista previa real, texto alternativo y la opción de enlace externo (lo que existía antes, para no
 * romper bloques ya guardados). Usa `useController` y no `setValue`: su `onChange` emite un evento
 * `"change"`, que es lo único que dispara el autoguardado del panel (ver `block-config-panel.tsx`).
 */
export function ImageField({
  name,
  label,
  optional,
  aspect,
  embedded = false,
}: {
  name: string;
  label: string;
  optional?: boolean;
  aspect?: "square" | "wide";
  /** Dentro de un ítem de lista (galería): sin marco propio. */
  embedded?: boolean;
}): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  const { control } = useFormContext();
  const url = useController({ control, name: `${name}.url` });
  const alt = useController({ control, name: `${name}.alt` });
  const decorative = useController({ control, name: `${name}.decorative` });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [externalOpen, setExternalOpen] = useState(false);
  const altId = useId();
  const altErrorId = `${altId}-error`;

  const currentUrl = typeof url.field.value === "string" ? url.field.value.trim() : "";
  const altValue = typeof alt.field.value === "string" ? alt.field.value : "";
  const isDecorative = Boolean(decorative.field.value);
  const srcSet = currentUrl ? mediaSrcSet(currentUrl) : null;
  const urlError = url.fieldState.error?.message;

  const body = (
    <div className="flex flex-col gap-3">
      {currentUrl ? (
        <div className="flex items-start gap-3">
          <div className={cn("shrink-0 overflow-hidden rounded-md border border-border bg-surface", aspect === "wide" ? "h-20 w-36" : "size-20")}>
            {/* Vista previa de una variante ya optimizada por el worker (o una URL externa elegida por
                el usuario): next/image exigiría declarar cada dominio posible. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentUrl}
              srcSet={srcSet ?? undefined}
              sizes={srcSet ? "144px" : undefined}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="truncate text-xs text-muted-foreground">{srcSet ? "De tu biblioteca" : currentUrl}</span>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)} disabled={!organizationId}>
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Cambiar
              </Button>
              {optional ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    url.field.onChange("");
                    alt.field.onChange("");
                    decorative.field.onChange(false);
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Quitar
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={!organizationId}
          className={cn(
            "flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border-strong bg-surface/40 px-4 text-center transition-colors hover:border-primary hover:bg-primary/5",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
            aspect === "wide" ? "py-8" : "py-6",
          )}
        >
          <ImagePlus className="size-5 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">Elegir imagen</span>
          {aspect ? <span className="text-xs text-muted-foreground">Recomendado: {ASPECT_HINT[aspect]}</span> : null}
        </button>
      )}
      {urlError ? (
        <p role="alert" className="text-sm text-danger">
          {urlError}
        </p>
      ) : null}

      {currentUrl ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={altId} className="text-sm font-medium text-foreground">
              Texto alternativo
            </label>
            <input
              id={altId}
              type="text"
              maxLength={300}
              disabled={isDecorative}
              aria-invalid={Boolean(alt.fieldState.error) && !isDecorative}
              aria-describedby={alt.fieldState.error && !isDecorative ? altErrorId : undefined}
              className={inputClass}
              value={isDecorative ? "" : altValue}
              onChange={(event) => alt.field.onChange(event.target.value)}
              onBlur={alt.field.onBlur}
              placeholder="Qué muestra la imagen, en pocas palabras"
            />
            {alt.fieldState.error?.message && !isDecorative ? (
              <span id={altErrorId} role="alert" className="text-xs text-danger">
                {alt.fieldState.error.message}
              </span>
            ) : !isDecorative && altValue.trim().length === 0 ? (
              <span className="text-xs text-muted-foreground">Descríbela para quien no puede verla, o márcala como decorativa.</span>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-border-strong"
              checked={isDecorative}
              onChange={(event) => decorative.field.onChange(event.target.checked)}
            />
            Es decorativa (no aporta información)
          </label>
        </>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          className="flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={externalOpen}
          onClick={() => setExternalOpen((open) => !open)}
        >
          <Link2 className="size-3.5" aria-hidden="true" />
          Usar un enlace externo
        </button>
        {externalOpen ? (
          <input
            type="url"
            placeholder="https://…"
            className={inputClass}
            aria-label={`Enlace externo de ${label}`}
            value={currentUrl}
            onChange={(event) => url.field.onChange(event.target.value)}
            onBlur={url.field.onBlur}
          />
        ) : null}
      </div>

      {organizationId ? (
        <MediaPicker
          organizationId={organizationId}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          hint={aspect ? ASPECT_HINT[aspect] : undefined}
          onSelect={(asset) => {
            if (asset.url) {
              url.field.onChange(asset.url);
            }
          }}
        />
      ) : null}
    </div>
  );

  if (embedded) {
    return body;
  }
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-foreground">
        {label}
        {optional ? " (opcional)" : ""}
      </legend>
      {body}
    </fieldset>
  );
}
