import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssignStaffToServiceInput,
  BookableServiceInput,
  BookingBlackoutInput,
  BookingBranchInput,
  BookingSettingsInput,
  BookingStaffInput,
  UpdateBookableServiceInput,
  UpdateBookingBranchInput,
  UpdateBookingStaffInput,
} from "@impulza/validation";
import {
  assignStaffToService,
  createBookableService,
  createBookingBlackout,
  createBookingBranch,
  createBookingStaff,
  deleteBookableService,
  deleteBookingBlackout,
  deleteBookingBranch,
  deleteBookingStaff,
  getBookingAvailability,
  getBookingSettings,
  listBookableServices,
  listBookingBlackouts,
  listBookingBranches,
  listBookingStaff,
  saveBookingSettings,
  updateBookableService,
  updateBookingBranch,
  updateBookingStaff,
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

// --- Sucursales (F7.9a) ---

export function useBookingBranches(organizationId: string, siteId: string) {
  return useQuery({ queryKey: [...root(organizationId, siteId), "branches"], queryFn: () => listBookingBranches(organizationId, siteId) });
}

export function useCreateBookingBranch(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({ mutationFn: (body: BookingBranchInput) => createBookingBranch(organizationId, siteId, body), onSuccess: invalidate });
}

export function useUpdateBookingBranch(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({
    mutationFn: ({ branchId, changes }: { branchId: string; changes: UpdateBookingBranchInput }) => updateBookingBranch(organizationId, siteId, branchId, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteBookingBranch(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({ mutationFn: (branchId: string) => deleteBookingBranch(organizationId, siteId, branchId), onSuccess: invalidate });
}

// --- Profesionales (F7.9a) ---

export function useBookingStaff(organizationId: string, siteId: string) {
  return useQuery({ queryKey: [...root(organizationId, siteId), "staff"], queryFn: () => listBookingStaff(organizationId, siteId) });
}

export function useCreateBookingStaff(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({ mutationFn: (body: BookingStaffInput) => createBookingStaff(organizationId, siteId, body), onSuccess: invalidate });
}

export function useUpdateBookingStaff(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({
    mutationFn: ({ staffId, changes }: { staffId: string; changes: UpdateBookingStaffInput }) => updateBookingStaff(organizationId, siteId, staffId, changes),
    onSuccess: invalidate,
  });
}

export function useDeleteBookingStaff(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({ mutationFn: (staffId: string) => deleteBookingStaff(organizationId, siteId, staffId), onSuccess: invalidate });
}

export function useAssignStaffToService(organizationId: string, siteId: string) {
  const invalidate = useInvalidateBooking(organizationId, siteId);
  return useMutation({
    mutationFn: ({ serviceId, body }: { serviceId: string; body: AssignStaffToServiceInput }) => assignStaffToService(organizationId, siteId, serviceId, body),
    onSuccess: invalidate,
  });
}

// --- Bloqueos y Disponibilidad ---

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

export function useBookingAvailability(
  organizationId: string,
  siteId: string,
  query: { serviceId: string; from: string; days: number; staffId?: string; branchId?: string } | null,
) {
  return useQuery({
    queryKey: [...root(organizationId, siteId), "availability", query],
    queryFn: () => getBookingAvailability(organizationId, siteId, query!),
    enabled: query !== null,
  });
}
