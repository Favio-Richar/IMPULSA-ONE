import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgencyClientAction, CreateAgencyClientDto, LinkAgencyClientDto } from "@impulza/validation";
import {
  acceptAgencyLink,
  acceptOwnerInvitation,
  actOnAgencyClient,
  createAgencyClient,
  enableAgency,
  getAgencyLink,
  getAgencyStatus,
  listAgencyClients,
  rejectAgencyLink,
  requestAgencyLink,
  revokeAgencyLink,
} from "../api/agency";

const statusKey = (organizationId: string) => ["agency", organizationId, "status"] as const;
const clientsKey = (organizationId: string) => ["agency", organizationId, "clients"] as const;
const linkKey = (organizationId: string) => ["agency", organizationId, "link"] as const;

/** Estado del modo agencia de la organización (¿es agencia?, ¿su plan lo incluye?, cupo). */
export function useAgencyStatus(organizationId: string) {
  return useQuery({ queryKey: statusKey(organizationId), queryFn: () => getAgencyStatus(organizationId) });
}

export function useAgencyClients(organizationId: string, enabled: boolean) {
  return useQuery({ queryKey: clientsKey(organizationId), queryFn: () => listAgencyClients(organizationId), enabled });
}

/** Tras cambiar una relación hay que refrescar la lista de organizaciones del selector (aparecen o desaparecen clientes). */
function useRefresh(organizationId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["agency", organizationId] }),
      queryClient.invalidateQueries({ queryKey: ["organizations"] }),
      queryClient.invalidateQueries({ queryKey: ["organization-plan", organizationId] }),
    ]);
  };
}

export function useEnableAgency(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: () => enableAgency(organizationId), onSuccess: refresh });
}

export function useCreateAgencyClient(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: (body: CreateAgencyClientDto) => createAgencyClient(organizationId, body), onSuccess: refresh });
}

export function useRequestAgencyLink(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: (body: LinkAgencyClientDto) => requestAgencyLink(organizationId, body), onSuccess: refresh });
}

export function useAgencyClientAction(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({
    mutationFn: (input: { clientId: string; action: AgencyClientAction }) => actOnAgencyClient(organizationId, input.clientId, input.action),
    onSuccess: refresh,
  });
}

// ---- lado del negocio ----------------------------------------------------------------------------------------

export function useAgencyLink(organizationId: string) {
  return useQuery({ queryKey: linkKey(organizationId), queryFn: () => getAgencyLink(organizationId) });
}

export function useAcceptAgencyLink(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: () => acceptAgencyLink(organizationId), onSuccess: refresh });
}

export function useRejectAgencyLink(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: () => rejectAgencyLink(organizationId), onSuccess: refresh });
}

export function useRevokeAgencyLink(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: () => revokeAgencyLink(organizationId), onSuccess: refresh });
}

export function useAcceptOwnerInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => acceptOwnerInvitation(token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations"] }),
  });
}
