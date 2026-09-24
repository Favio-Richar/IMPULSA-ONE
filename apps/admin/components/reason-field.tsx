import { cn } from "@impulza/ui";
import { useId } from "react";

/**
 * Motivo escrito de una acción de superadministración (ADR-005 §6): obligatorio, queda en la
 * auditoría. Mismo estilo que `Input` de `@impulza/ui`, que no tiene variante multilínea.
 */
export function ReasonField({
  label = "Motivo",
  value,
  onChange,
  error,
  helperText = "Queda registrado en la auditoría con tu nombre.",
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helperText?: string;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        <span className="text-danger" aria-hidden="true">
          {" "}
          *
        </span>
      </label>
      <textarea
        id={id}
        required
        rows={2}
        maxLength={500}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        className={cn(
          "min-h-16 rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground",
          "placeholder:text-disabled-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-2",
          error && "border-danger focus-visible:ring-danger",
        )}
      />
      <p id={`${id}-hint`} className={cn("text-sm", error ? "text-danger" : "text-muted-foreground")} role={error ? "alert" : undefined}>
        {error ?? helperText}
      </p>
    </div>
  );
}

/** Mismo mínimo que el servidor (`admin-actions.dto.ts`): se avisa antes de enviar. */
export function reasonError(reason: string): string | undefined {
  return reason.trim().length < 5 ? "Explica el motivo (al menos 5 caracteres)." : undefined;
}
