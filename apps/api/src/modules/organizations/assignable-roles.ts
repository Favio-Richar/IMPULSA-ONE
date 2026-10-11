// OWNER se asigna solo al crear la organización (creador) y no se reasigna por esta vía;
// SUPER_ADMIN es un rol de plataforma, no de organización (ADR-002 §4) — ninguno de los dos es
// invitable/asignable a través de /organizations/:id/members.
export const ASSIGNABLE_ROLES = ["ADMIN", "EDITOR", "ANALYST", "SUPPORT", "AGENCY_MANAGER", "CLIENT_VIEWER"] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(value: string): value is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}
