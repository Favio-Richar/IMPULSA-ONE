import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomRoleDto } from "@impulza/validation";
import { listMembers } from "../api/organizations";
import { changeMemberRole, createCustomRole, deleteCustomRole, getRoles, inviteWithRole, removeMember, updateCustomRole, type RoleChoice } from "../api/team";

const membersKey = (organizationId: string) => ["members", organizationId] as const;
const rolesKey = (organizationId: string) => ["roles", organizationId] as const;

export function useMembers(organizationId: string) {
  return useQuery({ queryKey: membersKey(organizationId), queryFn: () => listMembers(organizationId) });
}

export function useRoles(organizationId: string) {
  return useQuery({ queryKey: rolesKey(organizationId), queryFn: () => getRoles(organizationId) });
}

/** Cambiar un rol o un permiso cambia lo que cada pantalla deja hacer: se refrescan equipo, roles y el plan (cupo de miembros). */
function useRefresh(organizationId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: membersKey(organizationId) }),
      queryClient.invalidateQueries({ queryKey: rolesKey(organizationId) }),
      queryClient.invalidateQueries({ queryKey: ["organization-plan", organizationId] }),
    ]);
  };
}

export function useInviteWithRole(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: (input: { email: string; choice: RoleChoice }) => inviteWithRole(organizationId, input.email, input.choice), onSuccess: refresh });
}

export function useChangeMemberRole(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: (input: { membershipId: string; choice: RoleChoice }) => changeMemberRole(organizationId, input.membershipId, input.choice), onSuccess: refresh });
}

export function useRemoveMember(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: (membershipId: string) => removeMember(organizationId, membershipId), onSuccess: refresh });
}

export function useSaveCustomRole(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({
    mutationFn: (input: { roleId: string | null; body: CustomRoleDto }) =>
      input.roleId === null ? createCustomRole(organizationId, input.body) : updateCustomRole(organizationId, input.roleId, input.body),
    onSuccess: refresh,
  });
}

export function useDeleteCustomRole(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: (roleId: string) => deleteCustomRole(organizationId, roleId), onSuccess: refresh });
}
