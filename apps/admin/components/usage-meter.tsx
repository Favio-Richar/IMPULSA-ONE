import { cn } from "@impulza/ui";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { formatInteger } from "../lib/format";

/**
 * Uso contra un límite del plan: mismo criterio que el medidor del panel (F4.3) — el estado se
 * escribe con ícono y texto además del color (WCAG), y "sin límite" no dibuja barra.
 */
export function UsageMeter({ label, used, max }: { label: string; used: number; max: number | null }): React.JSX.Element {
  const ratio = max === null || max === 0 ? 0 : used / max;
  const state = max === null ? "unlimited" : used > max ? "over" : used >= max ? "full" : ratio >= 0.8 ? "near" : "ok";

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-foreground">
          {formatInteger(used)} {max === null ? "" : `de ${formatInteger(max)}`}
        </span>
      </div>
      {max === null ? (
        <p className="text-xs text-muted-foreground">Sin límite.</p>
      ) : (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={Math.min(used, max)}
          aria-valuetext={`${used} de ${max}`}
          className={cn("h-2 w-full rounded-sm", state === "over" || state === "full" ? "bg-danger/15" : state === "near" ? "bg-warning/15" : "bg-primary/15")}
        >
          <div
            className={cn("h-2 rounded-sm", state === "over" || state === "full" ? "bg-danger" : state === "near" ? "bg-warning" : "bg-primary")}
            style={{ width: `${Math.min(Math.max(ratio * 100, used > 0 ? 3 : 0), 100)}%` }}
          />
        </div>
      )}
      {state === "full" || state === "over" ? (
        <p className="flex items-center gap-1 text-xs text-danger">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          {state === "over" ? "Por encima del límite." : "Límite alcanzado."}
        </p>
      ) : state === "near" ? (
        <p className="flex items-center gap-1 text-xs text-warning">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          Cerca del límite.
        </p>
      ) : null}
    </li>
  );
}
