import { OrganizationStatus } from "@impulza/database";

/**
 * Filtro de toda superficie pública (sitio, formularios, enlaces cortos, QR, eventos): una
 * organización bloqueada por superadministración deja de servirse (ADR-005 §6). Responde igual que
 * un recurso que no existe — 404, sin decir "bloqueado" — para no revelar nada a un visitante.
 * Una sola constante para que las cuatro superficies no puedan quedar con criterios distintos.
 *
 * También deja de servirse la organización cuya agencia ocultó el sitio público al pausar o archivar al cliente
 * (F9.3, `publicHiddenAt`): es reversible y no toca páginas ni versiones.
 */
export const ACTIVE_ORGANIZATION = { organization: { status: OrganizationStatus.ACTIVE, publicHiddenAt: null } } as const;
