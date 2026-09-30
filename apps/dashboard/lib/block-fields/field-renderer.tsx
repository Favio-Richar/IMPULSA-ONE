"use client";

import { Button } from "@impulza/ui";
import { Plus, X } from "lucide-react";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import type { FieldError } from "react-hook-form";
import { ImageField } from "../../components/block-editor/image-field";
import { RichTextEditor } from "../../components/block-editor/rich-text-editor";
import { defaultArrayItem } from "./defaults";
import type { FieldControl, FieldDescriptor } from "./types.js";

const inputClass =
  "h-10 rounded-md border border-border-strong bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]";
const labelTextClass = "text-sm font-medium text-foreground";

/**
 * Un `<FieldGroup>` por nivel de anidamiento (bloque, campo `group`, ítem de un campo `array`):
 * pinta cada `FieldDescriptor` con el control que le corresponde según `field.control.kind`. La
 * validación real sigue siendo el schema Zod del catálogo (`zodResolver`, en `BlockConfigPanel`) —
 * esto solo decide qué input mostrar, nunca qué es válido.
 */
export function FieldGroup({
  fields,
  namePrefix = "",
}: {
  fields: readonly FieldDescriptor[];
  namePrefix?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => (
        <FieldControlView key={namePrefix + field.name} field={field} namePrefix={namePrefix} />
      ))}
    </div>
  );
}

function fieldPath(namePrefix: string, name: string): string {
  return namePrefix ? `${namePrefix}.${name}` : name;
}

function FieldControlView({ field, namePrefix }: { field: FieldDescriptor; namePrefix: string }) {
  const name = fieldPath(namePrefix, field.name);
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext();
  const error = errorAt(errors, name);

  switch (field.control.kind) {
    case "group":
      return (
        <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium text-foreground">
            {field.label}
            {field.optional ? " (opcional)" : ""}
          </legend>
          <FieldGroup fields={field.control.fields} namePrefix={name} />
        </fieldset>
      );

    case "array":
      return <ArrayFieldView name={name} label={field.label} arrayControl={field.control} />;

    case "richtext":
      return (
        <Controller
          name={name}
          control={control}
          render={({ field: rhf }) => (
            <div className="flex flex-col gap-1.5">
              <span className={labelTextClass}>{field.label}</span>
              <RichTextEditor value={typeof rhf.value === "string" ? rhf.value : ""} onChange={rhf.onChange} />
              {error ? <FieldErrorText message={error} /> : null}
            </div>
          )}
        />
      );

    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="size-4 rounded border-border-strong" {...register(name)} />
          {field.label}
        </label>
      );

    case "select": {
      const options = field.control.options;
      return (
        <label className="flex flex-col gap-1.5">
          <span className={labelTextClass}>{field.label}</span>
          <select className={inputClass} {...register(name)}>
            {field.optional ? <option value="">—</option> : null}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {error ? (
            <FieldErrorText message={error} />
          ) : field.helperText ? (
            <span className="text-sm text-muted-foreground">{field.helperText}</span>
          ) : null}
        </label>
      );
    }

    case "image":
      return <ImageField name={name} label={field.label} optional={field.optional} aspect={field.control.aspect} />;

    case "video":
      return (
        <label className="flex flex-col gap-1.5">
          <span className={labelTextClass}>{field.label}</span>
          <input type="url" placeholder="https://…" className={inputClass} {...register(name)} />
          {error ? (
            <FieldErrorText message={error} />
          ) : (
            <span className="text-sm text-muted-foreground">Pega el enlace de un video de YouTube o Vimeo.</span>
          )}
        </label>
      );

    case "music":
      return (
        <label className="flex flex-col gap-1.5">
          <span className={labelTextClass}>{field.label}</span>
          <input type="url" placeholder="https://open.spotify.com/…" className={inputClass} {...register(name)} />
          {error ? (
            <FieldErrorText message={error} />
          ) : (
            <span className="text-sm text-muted-foreground">
              Pega el enlace de Spotify, SoundCloud o Apple Music (Compartir → Copiar enlace). No el código de inserción.
            </span>
          )}
        </label>
      );

    case "datetime":
      return (
        <label className="flex flex-col gap-1.5">
          <span className={labelTextClass}>
            {field.label}
            {field.optional ? " (opcional)" : ""}
          </span>
          <input type="datetime-local" className={inputClass} {...register(name)} />
          {error ? (
            <FieldErrorText message={error} />
          ) : field.helperText ? (
            <span className="text-sm text-muted-foreground">{field.helperText}</span>
          ) : null}
        </label>
      );

    case "lines": {
      const linesControl = field.control;
      // El esquema marca la línea exacta (`features.3`): se muestra con su número.
      const lineError = error ?? nestedErrorAt(errors, name);
      return (
        <label className="flex flex-col gap-1.5">
          <span className={labelTextClass}>
            {field.label}
            {field.optional ? " (opcional)" : ""}
          </span>
          <textarea
            rows={4}
            className="min-h-24 rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            {...register(name)}
          />
          {lineError ? (
            <FieldErrorText message={lineError} />
          ) : (
            <span className="text-sm text-muted-foreground">
              {field.helperText ?? `Una por línea (hasta ${linesControl.maxItems}, de ${linesControl.maxLength} caracteres).`}
            </span>
          )}
        </label>
      );
    }

    case "multiselect":
      return <MultiSelectFieldView name={name} label={field.label} control={field.control} error={error} />;

    case "number":
      return (
        <label className="flex flex-col gap-1.5">
          <span className={labelTextClass}>{field.label}</span>
          <input
            type="number"
            min={field.control.min}
            max={field.control.max}
            step={field.control.step}
            className={inputClass}
            {...register(name, { valueAsNumber: true })}
          />
          {error ? (
            <FieldErrorText message={error} />
          ) : field.helperText ? (
            <span className="text-sm text-muted-foreground">{field.helperText}</span>
          ) : null}
        </label>
      );

    case "text":
    case "url":
    case "email":
    case "phone":
    default: {
      const htmlType =
        field.control.kind === "url"
          ? "url"
          : field.control.kind === "email"
            ? "email"
            : field.control.kind === "phone"
              ? "tel"
              : "text";
      return (
        <label className="flex flex-col gap-1.5">
          <span className={labelTextClass}>{field.label}</span>
          <input
            type={htmlType}
            maxLength={field.control.kind === "text" ? field.control.maxLength : undefined}
            className={inputClass}
            {...register(name)}
          />
          {error ? <FieldErrorText message={error} /> : null}
          {!error && field.helperText ? <span className="text-sm text-muted-foreground">{field.helperText}</span> : null}
        </label>
      );
    }
  }
}

function MultiSelectFieldView({
  name,
  label,
  control: msControl,
  error,
}: {
  name: string;
  label: string;
  control: Extract<FieldControl, { kind: "multiselect" }>;
  error: string | undefined;
}) {
  const { control } = useFormContext();
  return (
    <Controller
      name={name}
      control={control}
      render={({ field: rhf }) => {
        const value: string[] = Array.isArray(rhf.value) ? rhf.value : [];
        function toggle(optionValue: string, checked: boolean): void {
          if (checked) {
            if (value.length >= msControl.max) {
              return;
            }
            rhf.onChange([...value, optionValue]);
          } else {
            rhf.onChange(value.filter((item) => item !== optionValue));
          }
        }
        return (
          <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium text-foreground">{label}</legend>
            {msControl.options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4 rounded border-border-strong"
                  checked={value.includes(option.value)}
                  onChange={(event) => toggle(option.value, event.target.checked)}
                />
                {option.label}
              </label>
            ))}
            {error ? <FieldErrorText message={error} /> : null}
          </fieldset>
        );
      }}
    />
  );
}

function ArrayFieldView({
  name,
  label,
  arrayControl,
}: {
  name: string;
  label: string;
  arrayControl: Extract<FieldControl, { kind: "array" }>;
}) {
  const { control } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name });

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className={labelTextClass}>{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={fields.length >= arrayControl.max}
          onClick={() => append(defaultArrayItem(arrayControl.fields))}
        >
          <Plus className="size-4" />
          Agregar {arrayControl.itemLabel.toLowerCase()}
        </Button>
      </div>
      {fields.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay ninguno.</p> : null}
      {fields.map((item, index) => (
        <div key={item.id} className="flex flex-col gap-2 rounded-md border border-border-strong p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {arrayControl.itemLabel} {index + 1}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Quitar ${arrayControl.itemLabel.toLowerCase()} ${index + 1}`}
              disabled={fields.length <= arrayControl.min}
              onClick={() => remove(index)}
            >
              <X className="size-4" />
            </Button>
          </div>
          {arrayControl.itemKind === "image" ? (
            <ImageField name={`${name}.${index}`} label={`${arrayControl.itemLabel} ${index + 1}`} embedded />
          ) : (
            <FieldGroup fields={arrayControl.fields} namePrefix={`${name}.${index}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function FieldErrorText({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}

/** Primer error debajo de `path` (una línea de una lista), con el número de línea. */
function nestedErrorAt(errors: Record<string, unknown>, path: string): string | undefined {
  let current: unknown = errors;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === null || typeof current !== "object") return undefined;
  for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
    const message = (value as FieldError | undefined)?.message;
    if (typeof message === "string") return /^\d+$/.test(key) ? `Línea ${Number(key) + 1}: ${message}` : message;
  }
  return undefined;
}

function errorAt(errors: Record<string, unknown>, path: string): string | undefined {
  const segments = path.split(".");
  let current: unknown = errors;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  const fieldError = current as FieldError | undefined;
  return typeof fieldError?.message === "string" ? fieldError.message : undefined;
}
