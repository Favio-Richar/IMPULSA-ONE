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
}: {
  legend: string;
  name: string;
  choices: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: 2 | 3;
}) {
  const id = useId();

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
                "group relative flex cursor-pointer flex-col items-start gap-3 overflow-hidden rounded-2xl border-2 p-5 pr-12 transition-all duration-200 ease-out motion-reduce:transform-none motion-reduce:transition-none",
                "hover:-translate-y-1 hover:shadow-lg",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)] has-[:focus-visible]:ring-offset-2",
                checked
                  ? "border-primary bg-gradient-to-br from-primary/10 via-primary/5 to-transparent shadow-md shadow-primary/10"
                  : "border-border bg-background/90 hover:border-primary/40",
              )}
            >
              {Icon ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-12 shrink-0 items-center justify-center rounded-xl transition-all duration-200 group-hover:scale-105",
                    checked ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30" : "bg-surface text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  <Icon className="size-5" />
                </span>
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-base font-semibold tracking-tight text-foreground">{choice.label}</span>
                {choice.description ? <span className="text-sm leading-snug text-muted-foreground">{choice.description}</span> : null}
              </span>
              {/* El radio real, con apariencia de círculo con check (visible, enfocable y operable como cualquier radio). */}
              <span className="absolute right-4 top-4 size-6 shrink-0">
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
