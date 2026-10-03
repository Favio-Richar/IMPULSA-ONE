import { z } from "zod";
import { AGENCY_BILLING_MODES, type AgencyBillingModeValue } from "./index.js";

// Quién paga el plan de un cliente (F9.5a, ADR-028 §2). `AGENCY_PAYS` = el negocio usa los límites del plan de la agencia (su
// cupo); no se cobra nada nuevo ni se custodian medios de pago (CLAUDE.md). El cambio lo decide el propietario del cliente.

export const changeBillingSchema = z.object({ billingMode: z.enum(AGENCY_BILLING_MODES) });
export type ChangeBillingDto = z.infer<typeof changeBillingSchema>;

export type BillingRequester = "AGENCY" | "OWNER";

export type BillingChangePlan =
  /** Ya está en ese modo: no hay nada que cambiar. */
  | { kind: "noop" }
  /** Se aplica en el acto: lo pide el propio propietario, o todavía no existe un propietario que deba confirmar. */
  | { kind: "apply_now"; reason: "owner_request" | "no_owner_yet" }
  /** Queda pendiente hasta que el propietario del cliente lo confirme. */
  | { kind: "needs_owner" }
  /** Nadie puede pedir esto por esa vía. */
  | { kind: "forbidden"; message: string };

/**
 * Reglas del cambio de facturación:
 * - Pedir el modo actual no hace nada.
 * - El propietario solo puede pedir **volver a pagar él** (`CLIENT_PAYS`), y se aplica al instante: es su propio costo. Que la
 *   agencia pague (`AGENCY_PAYS`) lo ofrece la agencia, no se le pide a ella desde el lado del negocio.
 * - La agencia propone cualquier cambio y exige confirmación del propietario, porque mueve quién paga y con qué límites trabaja
 *   el negocio. La única excepción: un cliente que la agencia creó y cuyo propietario aún no acepta la invitación (no hay a quién pedírsela).
 */
export function planBillingChange(input: {
  current: AgencyBillingModeValue;
  requested: AgencyBillingModeValue;
  requester: BillingRequester;
  /** El propietario real del negocio ya existe y aceptó (en un cliente que creó la agencia, tras aceptar la invitación). */
  ownerAccepted: boolean;
}): BillingChangePlan {
  if (input.requested === input.current) return { kind: "noop" };
  if (input.requester === "OWNER") {
    if (input.requested !== "CLIENT_PAYS") {
      return { kind: "forbidden", message: "Solo la agencia puede ofrecer pagar el plan. Tú puedes volver a pagarlo tú." };
    }
    return { kind: "apply_now", reason: "owner_request" };
  }
  return input.ownerAccepted ? { kind: "needs_owner" } : { kind: "apply_now", reason: "no_owner_yet" };
}
