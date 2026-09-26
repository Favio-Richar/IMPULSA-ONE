"use client";

import { cn } from "@impulza/ui";
import { useId } from "react";

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/**
 * Grupo de opciones como tarjetas (pasos 1-3 del onboarding). Son radios nativos dentro de su
 * etiqueta: teclado (flechas), lector de pantalla y foco funcionan sin reimplementar nada.
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
          return (
            <label
              key={choice.value}
              htmlFor={inputId}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-4 transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-focus-ring)] has-[:focus-visible]:ring-offset-2",
                checked ? "border-primary bg-surface" : "border-border hover:bg-surface",
              )}
            >
              <input
                id={inputId}
                type="radio"
                name={name}
                value={choice.value}
                checked={checked}
                onChange={() => onChange(choice.value)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
              />
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">{choice.label}</span>
                {choice.description ? <span className="text-sm text-muted-foreground">{choice.description}</span> : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
