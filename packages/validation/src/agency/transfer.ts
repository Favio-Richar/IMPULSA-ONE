import { z } from "zod";
import { slugSchema } from "../slug.js";
import type { AgencyClientStatusValue } from "./index.js";

// Traspaso de un cliente (F9.5b, ADR-028 §2): a su propietario o a otra agencia. El propietario del negocio SIEMPRE consiente
// (si no, una agencia podría pasar a un cliente a otra sin que él lo sepa); la agencia receptora también, cuando el destino es
// otra agencia. Antes de completarse nada cambia; al completarse cambia la relación y nunca se mueven datos.

/** Días que tienen las partes para decidir antes de que el traspaso venza. */
export const AGENCY_TRANSFER_TTL_DAYS = 14;

const emailSchema = z.string().trim().toLowerCase().email("Escribe un correo válido.").max(254);

/**
 * A otra agencia se la identifica con su identificador **y** el correo de su propietario: así nadie puede sondear qué agencias
 * existen probando identificadores (mismo criterio que vincular un negocio).
 */
export const createTransferSchema = z.discriminatedUnion("to", [
  z.object({ to: z.literal("OWNER") }),
  z.object({ to: z.literal("AGENCY"), agencySlug: slugSchema, agencyOwnerEmail: emailSchema }),
]);
export type CreateTransferDto = z.infer<typeof createTransferSchema>;

export type TransferTargetKind = "OWNER" | "AGENCY";
export type TransferParty = "OWNER" | "RECEIVER";

/** Solo un cliente `ACTIVE` se puede traspasar: desde una pausa, `TRANSFERRING` daría escritura antes de tiempo. */
export function canStartTransfer(status: AgencyClientStatusValue): boolean {
  return status === "ACTIVE";
}

/** Quién debe consentir: siempre el propietario, y la agencia receptora si el destino es otra agencia. */
export function requiredConsents(toKind: TransferTargetKind): TransferParty[] {
  return toKind === "AGENCY" ? ["OWNER", "RECEIVER"] : ["OWNER"];
}

/** Qué falta para completar el traspaso (vacío = completo). */
export function missingConsents(input: { toKind: TransferTargetKind; ownerAcceptedAt: Date | null; receiverAcceptedAt: Date | null }): TransferParty[] {
  return requiredConsents(input.toKind).filter((party) => (party === "OWNER" ? input.ownerAcceptedAt === null : input.receiverAcceptedAt === null));
}

export function isTransferExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function transferExpiry(now: Date): Date {
  return new Date(now.getTime() + AGENCY_TRANSFER_TTL_DAYS * 24 * 60 * 60 * 1000);
}
