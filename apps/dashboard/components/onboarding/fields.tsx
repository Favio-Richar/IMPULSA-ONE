"use client";

import { cn } from "@impulza/ui";
import type { LucideIcon } from "lucide-react";
import { type InputHTMLAttributes, forwardRef, useId } from "react";

export interface IconInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helperText?: string | undefined;
  error?: string | undefined;
  /** Ícono contextual a la izquierda, dentro del campo. */
  icon?: LucideIcon;
  /** Texto fijo a la izquierda del valor (p. ej. el dominio de la dirección), como chip. */
  prefix?: string;
}

/**
 * Campo de texto del asistente: mismo contrato de accesibilidad que `Input` de `@impulza/ui` (etiqueta asociada, `aria-invalid`,
 * `aria-describedby` hacia la ayuda o el error, error con `role="alert"`), con un ícono contextual o un prefijo dentro del campo.
 * El ícono y el prefijo son decorativos (`aria-hidden`): el nombre accesible sigue siendo la etiqueta.
 */
export const IconInput = forwardRef<HTMLInputElement, IconInputProps>(
  ({ className, label, helperText, error, id, required, icon: Icon, prefix, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const helperId = `${inputId}-helper`;
    const errorId = `${inputId}-error`;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
          {required ? (
            <span className="text-danger" aria-hidden="true">
              {" "}
              *
            </span>
          ) : null}
        </label>

        <div
          className={cn(
            "flex h-12 items-stretch overflow-hidden rounded-xl border bg-background transition-shadow",
            "focus-within:ring-2 focus-within:ring-[var(--color-focus-ring)] focus-within:ring-offset-2",
            error ? "border-danger focus-within:ring-danger" : "border-border-strong",
          )}
        >
          {Icon ? (
            <span aria-hidden="true" className="flex w-11 shrink-0 items-center justify-center text-muted-foreground">
              <Icon className="size-4" />
            </span>
          ) : null}
          {prefix ? (
            <span aria-hidden="true" className="flex shrink-0 items-center border-r border-border bg-surface px-3 text-sm text-muted-foreground">
              {prefix}
            </span>
          ) : null}
          <input
            ref={ref}
            id={inputId}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={cn(helperText && helperId, error && errorId) || undefined}
            className={cn(
              "min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground placeholder:text-disabled-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
              Icon && "pl-0",
              className,
            )}
            {...props}
          />
        </div>

        {error ? (
          <p id={errorId} className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : helperText ? (
          <p id={helperId} className="text-sm text-muted-foreground">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  },
);
IconInput.displayName = "IconInput";
