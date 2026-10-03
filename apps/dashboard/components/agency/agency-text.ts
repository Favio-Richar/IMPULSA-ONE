import type { AgencyOverviewItem } from "@impulza/contracts";
import { ApiError } from "../../lib/api-client";

/** Texto de un error de la API: el mensaje del servidor si lo trae, o uno genérico. */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string") return body.message;
  }
  return fallback;
}

export const STATUS_TEXT: Record<AgencyOverviewItem["status"], string> = {
  INVITED: "Invitado",
  ACTIVE: "Activo",
  PAUSED: "En pausa (solo lectura)",
  ARCHIVED: "Archivado",
  TRANSFERRING: "En traspaso",
  ENDED: "Terminado",
};

export const BILLING_TEXT = { CLIENT_PAYS: "Paga el cliente", AGENCY_PAYS: "Paga la agencia" } as const;
