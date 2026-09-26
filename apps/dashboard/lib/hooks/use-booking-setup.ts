import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BookableServiceInput, BookingBlackoutInput, BookingSettingsInput, UpdateBookableServiceInput } from "@impulza/validation";
import {
  createBookableService,
  createBookingBlackout,
  deleteBookableService,
  deleteBookingBlackout,
  getBookingAvailability,
  getBookingSettings,
  listBookableServices,
  listBookingBlackouts,
  saveBookingSettings,
  updateBookableService,
} from "../api/booking";

const root = (organizationId: string, siteId: string) => ["booking", organizationId, siteId] as const;

/** Cualquier cambio de configuración cambia los horarios libres: se invalida todo el sitio. */
function useInvalidateBooking(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: root(organizationId, siteId) });
}

export function useBookingSettings(organizationId: string, siteId: string) {
  return useQuery({ queryKey: [...root(organizationId, siteId), "settings"], queryFn: () => getBookingSettings(organizationId, siteId) });
}

export function useSaveBookingSettings(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({ mutationFn: (body: BookingSettingsInput) => saveBookingSettings(organizationId, siteId, body), onSuccess: invalidate });
}

export function useBookableServices(organizationId: string, siteId: string) {
  return useQuery({ queryKey: [...root(organizationId, siteId), "services"], queryFn: () => listBookableServices(organizationId, siteId) });
}

export function useCreateBookableService(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({ mutationFn: (body: BookableServiceInput) => createBookableService(organizationId, siteId, body), onSuccess: invalidate });
}

export function useUpdateBookableService(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({
    mutationFn: ({ serviceId, changes }: { serviceId: string; changes: UpdateBookableServiceInput }) => updateBookableService(organizationId, siteId, serviceId, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteBookableService(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({ mutationFn: (serviceId: string) => deleteBookableService(organizationId, siteId, serviceId), onSuccess: invalidate });
}

export function useBookingBlackouts(organizationId: string, siteId: string) {
  return useQuery({ queryKey: [...root(organizationId, siteId), "blackouts"], queryFn: () => listBookingBlackouts(organizationId, siteId) });
}

export function useCreateBookingBlackout(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({ mutationFn: (body: BookingBlackoutInput) => createBookingBlackout(organizationId, siteId, body), onSuccess: invalidate });
}

export function useDeleteBookingBlackout(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({ mutationFn: (blackoutId: string) => deleteBookingBlackout(organizationId, siteId, blackoutId), onSuccess: invalidate });
}

export function useBookingAvailability(organizationId: string, siteId: string, query: { serviceId: string; from: string; days: number } | null) {
  return useQuery({
    queryKey: [...root(organizationId, siteId), "availability", query],
    queryFn: () => getBookingAvailability(organizationId, siteId, query!),
    enabled: query !== null,
  });
}
