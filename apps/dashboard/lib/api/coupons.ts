import type { CouponResponse } from "@impulza/contracts";
import type { CreateCouponInput, UpdateCouponInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

// Cupones de descuento del sitio (F7.8b, ADR-023).

function couponsPath(organizationId: string, siteId: string): string {
  return `/organizations/${organizationId}/sites/${siteId}/coupons`;
}

export function listCoupons(organizationId: string, siteId: string): Promise<CouponResponse[]> {
  return apiFetch<CouponResponse[]>(couponsPath(organizationId, siteId));
}

export function createCoupon(organizationId: string, siteId: string, body: CreateCouponInput): Promise<CouponResponse> {
  return apiFetch<CouponResponse>(couponsPath(organizationId, siteId), { method: "POST", body });
}

export function updateCoupon(organizationId: string, siteId: string, couponId: string, body: UpdateCouponInput): Promise<CouponResponse> {
  return apiFetch<CouponResponse>(`${couponsPath(organizationId, siteId)}/${couponId}`, { method: "PATCH", body });
}

export function deleteCoupon(organizationId: string, siteId: string, couponId: string): Promise<void> {
  return apiFetch<void>(`${couponsPath(organizationId, siteId)}/${couponId}`, { method: "DELETE" });
}
