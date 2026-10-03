import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgencyClientAction, CreateAgencyClientDto, CreateTransferDto, LinkAgencyClientDto } from "@impulza/validation";
import {
  acceptAgencyLink,
  acceptIncomingTransfer,
  acceptOwnerTransfer,
  acceptOwnerInvitation,
  actOnAgencyClient,
  cancelAgencyBilling,
  cancelAgencyTransfer,
  changeOwnerBilling,
  confirmOwnerBilling,
  createAgencyClient,
  enableAgency,
  getAgencyClientBilling,
  getAgencyDashboard,
  getAgencyLink,
  getAgencyOverview,
  getAgencyStatus,
  getOwnerBilling,
  getOwnerTransfer,
  listIncomingTransfers,
  proposeAgencyBilling,
  rejectIncomingTransfer,
  rejectOwnerBilling,
  rejectOwnerTransfer,
  startAgencyTransfer,
  type AgencyOverviewParams,
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
    mutationFn: (input: { clientId: string; action: AgencyClientAction; hidePublicSite?: boolean }) =>
      actOnAgencyClient(organizationId, input.clientId, input.action, input.hidePublicSite),
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

/** Totales y alertas de la agencia en un período (solo clientes activos). */
export function useAgencyDashboard(organizationId: string, days: number, enabled: boolean) {
  return useQuery({ queryKey: ["agency", organizationId, "dashboard", days], queryFn: () => getAgencyDashboard(organizationId, days), enabled });
}

/** Una página de la tabla de clientes; conserva la página anterior en pantalla mientras llega la siguiente. */
export function useAgencyOverview(organizationId: string, params: AgencyOverviewParams, enabled: boolean) {
  return useQuery({
    queryKey: ["agency", organizationId, "overview", params],
    queryFn: () => getAgencyOverview(organizationId, params),
    enabled,
    placeholderData: keepPreviousData,
  });
}

// ---- quién paga el plan (F9.5a) ---------------------------------------------------------------------------------------

/** Historial y propuesta de facturación de un cliente, visto por la agencia (se pide al abrir el panel de la fila). */
export function useAgencyClientBilling(organizationId: string, relationId: string, enabled: boolean) {
  return useQuery({ queryKey: ["agency", organizationId, "billing", relationId], queryFn: () => getAgencyClientBilling(organizationId, relationId), enabled });
}

export function useProposeAgencyBilling(organizationId: string, relationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: (mode: "CLIENT_PAYS" | "AGENCY_PAYS") => proposeAgencyBilling(organizationId, relationId, mode), onSuccess: refresh });
}

export function useCancelAgencyBilling(organizationId: string, relationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: () => cancelAgencyBilling(organizationId, relationId), onSuccess: refresh });
}

/** Lo mismo, visto por el propietario del negocio. Solo se pide cuando el negocio tiene una agencia vinculada. */
export function useOwnerBilling(organizationId: string, enabled: boolean) {
  return useQuery({ queryKey: ["agency", organizationId, "owner-billing"], queryFn: () => getOwnerBilling(organizationId), enabled });
}

/** Tras decidir, cambia el plan efectivo del negocio: se refresca también todo lo que dependa de él. */
function useRefreshOwner(organizationId: string) {
  const refresh = useRefresh(organizationId);
  const queryClient = useQueryClient();
  return async () => {
    await refresh();
    await queryClient.invalidateQueries({ queryKey: ["organization-plan"] });
  };
}

export function useConfirmOwnerBilling(organizationId: string) {
  const refresh = useRefreshOwner(organizationId);
  return useMutation({ mutationFn: () => confirmOwnerBilling(organizationId), onSuccess: refresh });
}

export function useRejectOwnerBilling(organizationId: string) {
  const refresh = useRefreshOwner(organizationId);
  return useMutation({ mutationFn: () => rejectOwnerBilling(organizationId), onSuccess: refresh });
}

export function useChangeOwnerBilling(organizationId: string) {
  const refresh = useRefreshOwner(organizationId);
  return useMutation({ mutationFn: (mode: "CLIENT_PAYS" | "AGENCY_PAYS") => changeOwnerBilling(organizationId, mode), onSuccess: refresh });
}

// ---- traspaso de un cliente (F9.5b) -----------------------------------------------------------------------------------

export function useStartAgencyTransfer(organizationId: string, relationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: (body: CreateTransferDto) => startAgencyTransfer(organizationId, relationId, body), onSuccess: refresh });
}

export function useCancelAgencyTransfer(organizationId: string, relationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: () => cancelAgencyTransfer(organizationId, relationId), onSuccess: refresh });
}

/** Traspasos que otra agencia le ofrece a esta (solo los pendientes de su decisión). */
export function useIncomingTransfers(organizationId: string, enabled: boolean) {
  return useQuery({ queryKey: ["agency", organizationId, "incoming-transfers"], queryFn: () => listIncomingTransfers(organizationId), enabled });
}

export function useAcceptIncomingTransfer(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: (transferId: string) => acceptIncomingTransfer(organizationId, transferId), onSuccess: refresh });
}

export function useRejectIncomingTransfer(organizationId: string) {
  const refresh = useRefresh(organizationId);
  return useMutation({ mutationFn: (transferId: string) => rejectIncomingTransfer(organizationId, transferId), onSuccess: refresh });
}

/** El traspaso más reciente de un negocio, visto por su propietario. */
export function useOwnerTransfer(organizationId: string, enabled: boolean) {
  return useQuery({ queryKey: ["agency", organizationId, "owner-transfer"], queryFn: () => getOwnerTransfer(organizationId), enabled });
}

/** Al completarse un traspaso cambia la agencia del negocio y su plan: se refresca todo lo que dependa de ello. */
export function useAcceptOwnerTransfer(organizationId: string) {
  const refresh = useRefreshOwner(organizationId);
  return useMutation({ mutationFn: () => acceptOwnerTransfer(organizationId), onSuccess: refresh });
}

export function useRejectOwnerTransfer(organizationId: string) {
  const refresh = useRefreshOwner(organizationId);
  return useMutation({ mutationFn: () => rejectOwnerTransfer(organizationId), onSuccess: refresh });
}
