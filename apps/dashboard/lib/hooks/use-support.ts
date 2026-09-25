import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getSupportTicket, listSupportTickets, openSupportTicket, replySupportTicket } from "../api/support";

export function useSupportTickets(organizationId: string) {
  return useQuery({ queryKey: ["support-tickets", organizationId], queryFn: () => listSupportTickets(organizationId) });
}

export function useSupportTicket(organizationId: string, ticketId: string) {
  return useQuery({
    queryKey: ["support-ticket", organizationId, ticketId],
    queryFn: () => getSupportTicket(organizationId, ticketId),
    // Una respuesta del equipo puede llegar mientras la pantalla está abierta.
    refetchInterval: 60_000,
  });
}

export function useOpenSupportTicket(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { subject: string; body: string }) => openSupportTicket(organizationId, body),
    onSuccess: (ticket) => {
      queryClient.setQueryData(["support-ticket", organizationId, ticket.id], ticket);
      void queryClient.invalidateQueries({ queryKey: ["support-tickets", organizationId] });
    },
  });
}

export function useReplySupportTicket(organizationId: string, ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => replySupportTicket(organizationId, ticketId, body),
    onSuccess: (ticket) => {
      queryClient.setQueryData(["support-ticket", organizationId, ticketId], ticket);
      void queryClient.invalidateQueries({ queryKey: ["support-tickets", organizationId] });
    },
  });
}
