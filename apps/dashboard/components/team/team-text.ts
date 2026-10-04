import { ApiError } from "../../lib/api-client";

/** Cómo se llama cada rol del sistema en pantalla. */
export const ROLE_LABELS: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  EDITOR: "Editor",
  ANALYST: "Analista",
  SUPPORT: "Soporte",
  AGENCY_MANAGER: "Gestor de agencia",
  AGENCY_DELEGATE: "Agencia (acceso delegado)",
  SUPER_ADMIN: "Superadministrador",
};

export const roleLabel = (name: string): string => ROLE_LABELS[name] ?? name;

/** Lo que el servidor contestó (su mensaje ya está en español y sin datos sensibles), o el texto por defecto. */
export function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string") return body.message;
  }
  return fallback;
}

/** El valor de un `<select>` de roles: `role:ADMIN` o `custom:<id>`. */
export const encodeChoice = (choice: { role?: string | undefined; customRoleId?: string | undefined }): string =>
  choice.customRoleId !== undefined ? `custom:${choice.customRoleId}` : `role:${choice.role ?? ""}`;

export function decodeChoice(value: string): { role: string; customRoleId?: undefined } | { customRoleId: string; role?: undefined } {
  return value.startsWith("custom:") ? { customRoleId: value.slice("custom:".length) } : { role: value.slice("role:".length) };
}
