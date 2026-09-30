import type { BillingOverviewResponse, BillingSubscriptionResponse, CheckoutRedirectResponse, WithdrawalResponse } from "@impulza/contracts";
import type { StartCheckoutInput } from "@impulza/validation";
import { apiFetch } from "../api-client";

function billingPath(organizationId: string): string {
  return `/organizations/${organizationId}/billing`;
}

export function getBilling(organizationId: string): Promise<BillingOverviewResponse> {
  return apiFetch<BillingOverviewResponse>(billingPath(organizationId));
}

export function startCheckout(organizationId: string, body: StartCheckoutInput): Promise<CheckoutRedirectResponse> {
  return apiFetch<CheckoutRedirectResponse>(`${billingPath(organizationId)}/checkout`, { method: "POST", body });
}

export function cancelSubscription(organizationId: string): Promise<BillingSubscriptionResponse> {
  return apiFetch<BillingSubscriptionResponse>(`${billingPath(organizationId)}/cancel`, { method: "POST" });
}

export function resumeSubscription(organizationId: string): Promise<BillingSubscriptionResponse> {
  return apiFetch<BillingSubscriptionResponse>(`${billingPath(organizationId)}/resume`, { method: "POST" });
}

export function withdrawSubscription(organizationId: string): Promise<WithdrawalResponse> {
  return apiFetch<WithdrawalResponse>(`${billingPath(organizationId)}/withdraw`, { method: "POST" });
}
