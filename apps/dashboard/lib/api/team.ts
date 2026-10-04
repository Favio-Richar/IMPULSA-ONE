import type { CustomRoleResponse, RolesResponse } from "@impulza/contracts";
import type { CustomRoleDto } from "@impulza/validation";
import { apiFetch } from "../api-client";

// Equipo y roles (F9.6a, ADR-028 §3). Todo se resuelve en el servidor: la pantalla solo muestra lo que el servidor deja hacer.

/** Un rol que se elige al invitar o cambiar: uno del sistema o uno personalizado de la organización. */
export type RoleChoice = { role: string; customRoleId?: undefined } | { customRoleId: string; role?: undefined };

const rolesPath = (organizationId: string) => `/organizations/${organizationId}/roles`;

export function getRoles(organizationId: string): Promise<RolesResponse> {
  return apiFetch<RolesResponse>(rolesPath(organizationId));
}

export function createCustomRole(organizationId: string, body: CustomRoleDto): Promise<CustomRoleResponse> {
  return apiFetch<CustomRoleResponse>(rolesPath(organizationId), { method: "POST", body });
}

export function updateCustomRole(organizationId: string, roleId: string, body: CustomRoleDto): Promise<CustomRoleResponse> {
  return apiFetch<CustomRoleResponse>(`${rolesPath(organizationId)}/${roleId}`, { method: "PUT", body });
}

export function deleteCustomRole(organizationId: string, roleId: string): Promise<void> {
  return apiFetch<void>(`${rolesPath(organizationId)}/${roleId}`, { method: "DELETE" });
}

export function changeMemberRole(organizationId: string, membershipId: string, choice: RoleChoice): Promise<void> {
  return apiFetch<void>(`/organizations/${organizationId}/members/${membershipId}`, { method: "PATCH", body: choice });
}

export function removeMember(organizationId: string, membershipId: string): Promise<void> {
  return apiFetch<void>(`/organizations/${organizationId}/members/${membershipId}`, { method: "DELETE" });
}

export function inviteWithRole(organizationId: string, email: string, choice: RoleChoice): Promise<{ membershipId: string }> {
  return apiFetch(`/organizations/${organizationId}/members`, { method: "POST", body: { email, ...choice } });
}
