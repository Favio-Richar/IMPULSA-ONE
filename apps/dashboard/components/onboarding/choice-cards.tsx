"use client";

import { cn } from "@impulza/ui";
import { Check, type LucideIcon } from "lucide-react";
import { useId } from "react";

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
  /** Ícono de la opción (decorativo: el nombre accesible es la etiqueta y su descripción). */
  icon?: LucideIcon;
}

/**
 * Grupo de opciones como tarjetas (pasos 1-3 del onboarding). Son radios nativos dentro de su
 * etiqueta: teclado (flechas), lector de pantalla y foco funcionan sin reimplementar nada. El radio
 * se ve como un círculo con check (ya no el círculo del sistema) y sigue siendo el control real.
 */
export function ChoiceCards<T extends string>({
  legend,
  name,
  choices,
  value,
  onChange,
  columns = 2,
  variant = "default",
  accent = "primary",
}: {
  legend: string;
  name: string;
  choices: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: 2 | 3;
  /** `compact`: tarjeta horizontal más baja (ícono a la izquierda), para listas largas de opciones secundarias. */
  variant?: "default" | "compact";
  /**
   * `info`: suma el azul `info` del sistema como acento secundario de lo elegido (degradado primario→info en el ícono y el
   * fondo). El borde y el radio siguen en el color de marca. Por defecto, solo el color de marca.
   */
  accent?: "primary" | "info";
}) {
  const id = useId();
  const compact = variant === "compact";

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">{legend}</legend>
      <div className={cn("grid grid-cols-1 gap-3", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {choices.map((choice) => {
          const inputId = `${id}-${choice.value}`;
          const checked = value === choice.value;
          const Icon = choice.icon;
          return (
            <label
              key={choice.value}
              htmlFor={inputId}
              className={cn(
                "group relative flex cursor-pointer overflow-hidden border-2 transition-all duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none",
                compact ? "flex-row items-center gap-3 rounded-lg p-3.5 pr-11 hover:-translate-y-0.5 hover:shadow-md" : "flex-col items-start gap-3 rounded-lg p-5 pr-12 hover:-translate-y-1 hover:shadow-lg",
                // En dos columnas con un total impar, la última ocupa la fila entera en vez de quedar sola a la izquierda.
                compact && columns === 2 && "sm:[&:last-child:nth-child(odd)]:col-span-2",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)] has-[:focus-visible]:ring-offset-2",
                checked
                  ? accent === "info"
                    ? "border-primary bg-gradient-to-br from-primary/10 via-info/5 to-transparent shadow-md shadow-info/15"
                    : "border-primary bg-gradient-to-br from-primary/10 via-primary/5 to-transparent shadow-md shadow-primary/10"
                  : accent === "info"
                    ? "border-border bg-background/90 hover:border-info/50"
                    : "border-border bg-background/90 hover:border-primary/40",
              )}
            >
              {Icon ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex shrink-0 items-center justify-center transition-all duration-200 group-hover:scale-105",
                    compact ? "size-10 rounded-md" : "size-12 rounded-md",
                    checked
                      ? accent === "info"
                        ? "bg-gradient-to-br from-primary to-info text-primary-foreground shadow-lg shadow-info/30"
                        : "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                      : accent === "info"
                        ? "bg-info/10 text-info group-hover:bg-info/20"
                        : "bg-surface text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  <Icon className="size-5" />
                </span>
              ) : null}
              <span className={cn("flex min-w-0 flex-1 flex-col", compact ? "gap-0.5" : "gap-1")}>
                <span className={cn("font-semibold tracking-tight text-foreground", compact ? "text-sm leading-snug" : "text-base")}>{choice.label}</span>
                {choice.description ? (
                  <span className={cn("leading-snug text-muted-foreground", compact ? "text-[13px]" : "text-sm")}>{choice.description}</span>
                ) : null}
              </span>
              {/* El radio real, con apariencia de círculo con check (visible, enfocable y operable como cualquier radio). */}
              <span className={cn("absolute size-6 shrink-0", compact ? "right-3 top-1/2 -translate-y-1/2" : "right-4 top-4")}>
                <input
                  id={inputId}
                  type="radio"
                  name={name}
                  value={choice.value}
                  checked={checked}
                  onChange={() => onChange(choice.value)}
                  className="peer size-6 cursor-pointer appearance-none rounded-full border-2 border-border-strong bg-background transition-colors checked:border-primary checked:bg-primary focus-visible:outline-none"
                />
                <Check
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 m-auto size-3.5 scale-50 text-primary-foreground opacity-0 transition-all peer-checked:scale-100 peer-checked:opacity-100"
                  strokeWidth={3}
                />
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
