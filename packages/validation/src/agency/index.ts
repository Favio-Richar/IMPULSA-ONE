import { z } from "zod";
import { slugSchema } from "../slug.js";

/**
 * Modo agencia (F9.3, ADR-028 §2). La organización del cliente sigue siendo la unidad de aislamiento
 * (ADR-002): la agencia accede con membresías delegadas que nacen y mueren con la relación `AgencyClient`.
 */

export const AGENCY_CLIENT_STATUSES = ["INVITED", "ACTIVE", "PAUSED", "ARCHIVED", "TRANSFERRING", "ENDED"] as const;
export type AgencyClientStatusValue = (typeof AGENCY_CLIENT_STATUSES)[number];

export const AGENCY_BILLING_MODES = ["CLIENT_PAYS", "AGENCY_PAYS"] as const;
export type AgencyBillingModeValue = (typeof AGENCY_BILLING_MODES)[number];

/** Días de vigencia de la invitación al propietario de un cliente creado por la agencia. */
export const AGENCY_OWNER_INVITE_TTL_DAYS = 7;
/** Días de vigencia de una solicitud de vínculo sobre una organización que ya existía. */
export const AGENCY_LINK_REQUEST_TTL_DAYS = 14;

/** Roles de la agencia que reciben acceso delegado a sus clientes (F9.6 lo afina por cliente y módulo). */
export const AGENCY_DELEGATING_ROLES = ["OWNER", "ADMIN", "AGENCY_MANAGER"] as const;
/** Rol que la agencia tiene dentro de la organización de un cliente. */
export const AGENCY_DELEGATE_ROLE = "AGENCY_DELEGATE";

const emailSchema = z.string().trim().toLowerCase().email("Escribe un correo válido.").max(254);

export const createAgencyClientSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres.").max(120),
  slug: slugSchema,
  /** A esta persona se le invita a ser la propietaria del negocio (enlace firmado con vencimiento). */
  ownerEmail: emailSchema,
  billingMode: z.enum(AGENCY_BILLING_MODES).default("CLIENT_PAYS"),
});
export type CreateAgencyClientDto = z.infer<typeof createAgencyClientSchema>;

/**
 * Vincular una organización que ya existe. Pide el identificador **y** el correo de su propietario: así
 * nadie puede sondear qué organizaciones existen probando identificadores.
 */
export const linkAgencyClientSchema = z.object({
  clientSlug: slugSchema,
  ownerEmail: emailSchema,
});
export type LinkAgencyClientDto = z.infer<typeof linkAgencyClientSchema>;

export const AGENCY_CLIENT_ACTIONS = ["pause", "resume", "archive", "unarchive", "release"] as const;
export type AgencyClientAction = (typeof AGENCY_CLIENT_ACTIONS)[number];
export const agencyClientActionSchema = z
  .object({
    action: z.enum(AGENCY_CLIENT_ACTIONS),
    // Solo al pausar o archivar: `true` oculta el sitio público del cliente (reversible), `false` lo deja visible,
    // ausente no cambia lo que ya había. Reanudar, desarchivar y soltar siempre lo vuelven a mostrar.
    hidePublicSite: z.boolean().optional(),
  })
  .refine((value) => value.hidePublicSite === undefined || value.action === "pause" || value.action === "archive", {
    message: "Ocultar el sitio público solo se elige al pausar o archivar.",
    path: ["hidePublicSite"],
  });
export type AgencyClientActionDto = z.infer<typeof agencyClientActionSchema>;

export const acceptOwnerInvitationSchema = z.object({ token: z.string().trim().min(20).max(200) });
export type AcceptOwnerInvitationDto = z.infer<typeof acceptOwnerInvitationSchema>;

/**
 * Transición permitida de una acción sobre una relación. `null` = no se puede desde ese estado.
 * `agencyCreated` importa porque un cliente creado por la agencia en estado INVITED ya trabaja (la agencia lo
 * armó) mientras el propietario acepta; uno vinculado en INVITED todavía no da acceso.
 */
export function nextAgencyClientStatus(
  action: AgencyClientAction,
  status: AgencyClientStatusValue,
): AgencyClientStatusValue | null {
  switch (action) {
    case "pause":
      return status === "ACTIVE" ? "PAUSED" : null;
    case "resume":
      return status === "PAUSED" ? "ACTIVE" : null;
    case "archive":
      return status === "ACTIVE" || status === "PAUSED" || status === "INVITED" ? "ARCHIVED" : null;
    case "unarchive":
      return status === "ARCHIVED" ? "ACTIVE" : null;
    case "release":
      return status === "ENDED" ? null : "ENDED";
  }
}

// ---- Veredicto de acceso delegado (ADR-028 §2): la ÚNICA regla, aplicada en la puerta de entrada --------------

export interface DelegatedAccessInput {
  status: AgencyClientStatusValue;
  agencyCreated: boolean;
  method: string;
  /** Ruta de la petición, con o sin prefijo `/api/v1` y con o sin query. */
  path: string;
}

export type DelegatedAccessVerdict = { allowed: true } | { allowed: false; code: string; message: string };

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Lo que un cliente nunca delega, **por ruta** (los permisos del rol cubren el resto):
 * - `payment-accounts` y `billing`: su cuenta de cobro (token de Mercado Pago, ADR-013) y su suscripción.
 * - `members`: su equipo y su propietario (invitar, cambiar roles, remover; el propietario no se cambia por esta vía).
 * - cualquier `export`: sacar la lista de contactos de su negocio exige un permiso explícito del cliente (F9.6).
 * - `plan` solo se lee.
 * Los datos de acceso del propietario (contraseña, 2FA) viven fuera de las rutas de organización: no son alcanzables.
 */
const DENIED_SEGMENTS = new Set(["payment-accounts", "billing", "members"]);
const READ_ONLY_SEGMENTS = new Set(["plan"]);

/** Segmentos de la ruta después de `organizations/<id>/` (vacío si la ruta es la de la organización misma). */
export function segmentsAfterOrganization(path: string): string[] {
  const clean = path.split("?")[0] ?? "";
  const parts = clean.split("/").filter((part) => part !== "");
  const index = parts.indexOf("organizations");
  if (index === -1) return [];
  return parts.slice(index + 2);
}

export function delegatedAccessVerdict(input: DelegatedAccessInput): DelegatedAccessVerdict {
  const read = READ_METHODS.has(input.method.toUpperCase());

  switch (input.status) {
    case "ACTIVE":
    case "TRANSFERRING":
      break;
    case "INVITED":
      if (!input.agencyCreated) {
        return { allowed: false, code: "AGENCY_ACCESS_NOT_ACCEPTED", message: "El propietario del negocio todavía no aceptó tu solicitud." };
      }
      break;
    case "PAUSED":
      if (!read) {
        return { allowed: false, code: "AGENCY_CLIENT_PAUSED", message: "Este cliente está en pausa: la agencia puede ver pero no hacer cambios." };
      }
      break;
    case "ARCHIVED":
      return { allowed: false, code: "AGENCY_CLIENT_ARCHIVED", message: "Este cliente está archivado: la agencia ya no tiene acceso." };
    case "ENDED":
      return { allowed: false, code: "AGENCY_ACCESS_REVOKED", message: "La agencia ya no tiene acceso a este negocio." };
  }

  const segments = segmentsAfterOrganization(input.path);
  const [first] = segments;
  const isExport = segments.includes("export");
  if ((first !== undefined && DENIED_SEGMENTS.has(first)) || isExport) {
    return {
      allowed: false,
      code: "AGENCY_LIMIT",
      message: "Esta acción no se puede delegar a una agencia: la decide el propietario del negocio.",
    };
  }
  if (first !== undefined && READ_ONLY_SEGMENTS.has(first) && !read) {
    return { allowed: false, code: "AGENCY_LIMIT", message: "Esta acción no se puede delegar a una agencia: la decide el propietario del negocio." };
  }
  return { allowed: true };
}
