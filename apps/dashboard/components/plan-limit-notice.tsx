import { Gauge } from "lucide-react";
import Link from "next/link";
import { getPlanLimitInfo } from "../lib/plan-limit";

/**
 * Aviso de "límite de plan alcanzado" (F4.3). Se muestra en vez del error genérico cuando una alta
 * responde 402: dice qué límite, cuánto se usa y lleva a la pantalla de planes — el usuario tiene
 * permiso, lo que falta es cupo, así que el camino es subir de plan y no "reintentar".
 * Devuelve `null` si el error no es de límite: cada formulario sigue mostrando sus otros errores.
 */
export function PlanLimitNotice({ error }: { error: unknown }): React.JSX.Element | null {
  const info = getPlanLimitInfo(error);
  if (!info) {
    return null;
  }

  return (
    <div role="alert" className="flex gap-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
      <Gauge className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-medium text-foreground">{info.message}</p>
        <p className="text-muted-foreground">
          {info.key === "analyticsHistoryDays"
            ? `Tu plan ${info.planName} muestra hasta ${info.max} días de historial.`
            : `Plan ${info.planName}: ${info.used} de ${info.max}.`}{" "}
          <Link href="/plan" className="font-medium text-primary underline-offset-2 hover:underline">
            Ver planes
          </Link>
        </p>
      </div>
    </div>
  );
}
