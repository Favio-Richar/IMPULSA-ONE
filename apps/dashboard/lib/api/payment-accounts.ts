import type { PaymentAccountConnectResponse, PaymentAccountsResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

function accountsPath(organizationId: string): string {
  return `/organizations/${organizationId}/payment-accounts`;
}

export function getPaymentAccounts(organizationId: string): Promise<PaymentAccountsResponse> {
  return apiFetch<PaymentAccountsResponse>(accountsPath(organizationId));
}

export function startMercadoPagoConnect(organizationId: string): Promise<PaymentAccountConnectResponse> {
  return apiFetch<PaymentAccountConnectResponse>(`${accountsPath(organizationId)}/mercadopago/connect`, { method: "POST" });
}

export function disconnectMercadoPago(organizationId: string): Promise<void> {
  return apiFetch<void>(`${accountsPath(organizationId)}/mercadopago`, { method: "DELETE" });
}
