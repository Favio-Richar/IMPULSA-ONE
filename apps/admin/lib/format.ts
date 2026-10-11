const integer = new Intl.NumberFormat("es-CL");
const dateTime = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });
const date = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" });

export function formatInteger(value: number): string {
  return integer.format(value);
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatDate(iso: string): string {
  return date.format(new Date(iso));
}

/** Precio en la unidad mínima de la moneda (CLP: pesos; USD: centavos). Intl sabe cuántos
 *  decimales usa cada moneda (ISO 4217), así que no se asume ×100. */
export function formatPrice(amount: number, currency: string): string {
  if (amount === 0) {
    return "Gratis";
  }
  try {
    const formatter = new Intl.NumberFormat("es-CL", { style: "currency", currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amount / 10 ** digits);
  } catch {
    return `${integer.format(amount)} ${currency}`;
  }
}

export function formatLimit(value: number | null): string {
  return value === null ? "Sin límite" : integer.format(value);
}

export const ROLE_LABELS: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  EDITOR: "Editor",
  ANALYST: "Analista",
  SUPPORT: "Soporte",
  AGENCY_MANAGER: "Agencia",
  CLIENT_VIEWER: "Visor del portal",
};

export const PLAN_SOURCE_LABELS: Record<"subscription" | "assigned" | "agency" | "default", string> = {
  subscription: "Suscripción vigente",
  assigned: "Asignado a mano",
  agency: "Plan de su agencia (la agencia paga)",
  default: "Plan por defecto",
};

/** Texto legible de cada acción auditada que muestra la administración. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "admin.login": "Inició sesión en administración",
  "admin.logout": "Cerró sesión en administración",
  "admin.login_denied": "Intento de entrar a administración sin permiso",
  "admin.superadmin_granted": "Superadministración otorgada (servidor)",
  "admin.superadmin_revoked": "Superadministración revocada (servidor)",
  "admin.organization_viewed": "Vio el detalle de la organización",
  "admin.organization_plan_changed": "Cambió el plan",
  "admin.organization_blocked": "Bloqueó la organización",
  "admin.organization_unblocked": "Restauró la organización",
  "admin.plan_updated": "Editó un plan del catálogo",
  "admin.support_replied": "Respondió una solicitud de soporte",
  "admin.support_closed": "Cerró una solicitud de soporte",
  "support.ticket_opened": "Abrió una solicitud de soporte",
};

const clp = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

/** Dinero en pesos (F4.6d): a diferencia de `formatPrice`, un 0 se muestra como $0, no "Gratis". */
export function formatClp(amount: number): string {
  return clp.format(amount);
}

/** Mes en curso en hora de Chile, `YYYY-MM` (el mes contable del negocio). */
export function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
}

/** "2026-09" → "septiembre de 2026". */
export function formatMonth(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year!, monthIndex! - 1, 15)));
}
