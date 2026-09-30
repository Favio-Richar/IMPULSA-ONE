import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BookingStatusValue, ManualBookingInput } from "@impulza/validation";
import { createManualBooking, listBookings, refundBookingDeposit, updateBookingStatus, type AgendaQuery } from "../api/agenda";

const root = (organizationId: string) => ["agenda", organizationId] as const;

export function useAgenda(organizationId: string, query: AgendaQuery | null) {
  return useQuery({
    queryKey: [...root(organizationId), query],
    queryFn: () => listBookings(organizationId, query!),
    enabled: query !== null,
    // Al cambiar de semana, la anterior queda visible hasta que llega la nueva (sin parpadeo).
    placeholderData: keepPreviousData,
  });
}

export function useCreateManualBooking(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ManualBookingInput) => createManualBooking(organizationId, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: root(organizationId) }),
  });
}

export function useUpdateBookingStatus(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, status }: { bookingId: string; status: BookingStatusValue }) => updateBookingStatus(organizationId, bookingId, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: root(organizationId) }),
  });
}

export function useRefundBookingDeposit(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, amount }: { bookingId: string; amount?: number }) => refundBookingDeposit(organizationId, bookingId, amount),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: root(organizationId) }),
  });
}
