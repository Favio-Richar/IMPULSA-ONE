import type { CreateCouponInput, UpdateCouponInput } from "@impulza/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCoupon, deleteCoupon, listCoupons, updateCoupon } from "../api/coupons";

function couponsKey(organizationId: string, siteId: string) {
  return ["coupons", organizationId, siteId] as const;
}

export function useCoupons(organizationId: string, siteId: string) {
  return useQuery({ queryKey: couponsKey(organizationId, siteId), queryFn: () => listCoupons(organizationId, siteId) });
}

/** Crear o editar, y volver a pedir la lista (estado y usos los calcula el servidor). */
export function useSaveCoupon(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { couponId: null; body: CreateCouponInput } | { couponId: string; body: UpdateCouponInput }) =>
      args.couponId === null ? createCoupon(organizationId, siteId, args.body) : updateCoupon(organizationId, siteId, args.couponId, args.body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: couponsKey(organizationId, siteId) }),
  });
}

export function useDeleteCoupon(organizationId: string, siteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (couponId: string) => deleteCoupon(organizationId, siteId, couponId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: couponsKey(organizationId, siteId) }),
  });
}
