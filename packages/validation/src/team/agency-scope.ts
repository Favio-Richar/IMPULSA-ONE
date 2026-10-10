import { z } from "zod";

/**
 * Acceso del equipo de una agencia por cliente y por módulo (F9.6b, ADR-028 §3). Sin fila de alcance una persona ve todos los clientes y
 * todos los módulos (el comportamiento de F9.3); con ella se acota. Todo lo de aquí es puro: la API lo aplica en cada petición.
 */

/** Los módulos que se pueden acotar. Cada uno agrupa rutas de la API (ver `agencyModuleOfPath`). */
export const AGENCY_MODULES = [
  { key: "sitios", label: "Sitios y constructor" },
  { key: "contactos", label: "Contactos y formularios" },
  { key: "reservas", label: "Reservas" },
  { key: "catalogo", label: "Catálogo y pedidos" },
  { key: "campanas", label: "Campañas y automatizaciones" },
  { key: "medios", label: "Medios" },
  { key: "analitica", label: "Analítica" },
  { key: "enlaces", label: "Enlaces y QR" },
  { key: "soporte", label: "Soporte" },
  { key: "marca", label: "Marca" },
  { key: "ia", label: "Asistente de IA" },
] as const;

export type AgencyModuleKey = (typeof AGENCY_MODULES)[number]["key"];
export const AGENCY_MODULE_KEYS = AGENCY_MODULES.map((module) => module.key) as unknown as readonly [AgencyModuleKey, ...AgencyModuleKey[]];

/** Primer segmento de la ruta (después de `organizations/<id>/`) → módulo. Lo que no está aquí no es un módulo acotable (el servidor lo decide por otro lado). */
const ROOT_SEGMENT_MODULE: Record<string, AgencyModuleKey> = {
  sites: "sitios",
  themes: "sitios",
  "publish-requests": "sitios",
  contacts: "contactos",
  bookings: "reservas",
  orders: "catalogo",
  campaigns: "campanas",
  newsletter: "campanas",
  "email-sequences": "campanas",
  automations: "campanas",
  media: "medios",
  analytics: "analitica",
  "short-links": "enlaces",
  "qr-codes": "enlaces",
  "support-tickets": "soporte",
  "brand-profile": "marca",
  ai: "ia",
};

/** Dentro de `sites/<id>/…`: el segundo nivel decide el módulo; lo demás es el constructor de sitios. */
const SITE_SEGMENT_MODULE: Record<string, AgencyModuleKey> = {
  forms: "contactos",
  booking: "reservas",
  catalog: "catalogo",
  coupons: "catalogo",
  funnels: "analitica",
  "ab-tests": "analitica",
  measurement: "analitica",
  "page-campaigns": "campanas",
  ai: "ia",
};

/** El módulo al que pertenece una ruta de organización, o `null` si no es acotable (raíz, `agency`, `plan`, etc.). */
export function agencyModuleOfSegments(segments: readonly string[]): AgencyModuleKey | null {
  const [first, , third] = segments;
  if (first === undefined) return null;
  if (first === "sites") {
    return (third !== undefined ? SITE_SEGMENT_MODULE[third] : undefined) ?? "sitios";
  }
  return ROOT_SEGMENT_MODULE[first] ?? null;
}

export interface AgencyScope {
  /** `true` = todos los clientes de la agencia, incluidos los futuros. */
  allClients: boolean;
  /** Ids de relación `AgencyClient` permitidos cuando `allClients` es `false`. */
  clientIds: readonly string[];
  /** Vacío = todos los módulos. */
  modules: readonly AgencyModuleKey[];
}

/** Sin restricciones: lo que tiene quien no tiene fila de alcance. */
export const FULL_SCOPE: AgencyScope = { allClients: true, clientIds: [], modules: [] };

export function scopeAllowsClient(scope: AgencyScope, relationId: string): boolean {
  return scope.allClients || scope.clientIds.includes(relationId);
}

export function scopeAllowsModule(scope: AgencyScope, module: AgencyModuleKey | null): boolean {
  return module === null || scope.modules.length === 0 || scope.modules.includes(module);
}

/**
 * ¿`granted` cabe dentro de `actor`? Nadie da más alcance del que tiene: un administrador acotado a dos clientes no puede dar a otra
 * persona un tercero, ni un módulo que él no tiene.
 */
export function scopeWithin(actor: AgencyScope, granted: AgencyScope): boolean {
  if (!actor.allClients && (granted.allClients || granted.clientIds.some((id) => !actor.clientIds.includes(id)))) return false;
  if (actor.modules.length > 0 && (granted.modules.length === 0 || granted.modules.some((module) => !actor.modules.includes(module)))) return false;
  return true;
}

export const agencyScopeSchema = z
  .object({
    allClients: z.boolean(),
    clientIds: z.array(z.uuid()).max(500).default([]),
    modules: z.array(z.enum(AGENCY_MODULE_KEYS)).max(AGENCY_MODULE_KEYS.length).default([]),
  })
  .transform((value) => ({
    allClients: value.allClients,
    // Con «todos los clientes» la lista no significa nada: se descarta para que no quede un residuo engañoso.
    clientIds: value.allClients ? [] : [...new Set(value.clientIds)].sort(),
    modules: [...new Set(value.modules)].sort() as AgencyModuleKey[],
  }))
  .refine((value) => value.allClients || value.clientIds.length > 0, { message: "Elige al menos un cliente, o marca «todos los clientes».", path: ["clientIds"] });
export type AgencyScopeDto = z.infer<typeof agencyScopeSchema>;

/** Una persona que no puede cambiarse a sí misma ni acotar al propietario de la agencia. */
export type ScopeChangeVerdict = { allowed: true } | { allowed: false; code: "SELF_CHANGE" | "OWNER_PROTECTED" | "SCOPE_ESCALATION"; message: string };

export function scopeChangeVerdict(input: { actorUserId: string; targetUserId: string; targetRoleName: string; actorScope: AgencyScope; granted: AgencyScope }): ScopeChangeVerdict {
  if (input.actorUserId === input.targetUserId) {
    return { allowed: false, code: "SELF_CHANGE", message: "No puedes cambiar tu propio acceso: pídeselo a otra persona de la agencia." };
  }
  if (input.targetRoleName === "OWNER") {
    return { allowed: false, code: "OWNER_PROTECTED", message: "El acceso del propietario de la agencia no se acota." };
  }
  if (!scopeWithin(input.actorScope, input.granted)) {
    return { allowed: false, code: "SCOPE_ESCALATION", message: "No puedes dar más acceso del que tú tienes (clientes o módulos)." };
  }
  return { allowed: true };
}
