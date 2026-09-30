import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { disconnectMercadoPago, getPaymentAccounts, startMercadoPagoConnect } from "../api/payment-accounts";

function accountsKey(organizationId: string) {
  return ["payment-accounts", organizationId] as const;
}

/** Cuenta de Mercado Pago del negocio (F5.8). */
export function usePaymentAccounts(organizationId: string) {
  return useQuery({ queryKey: accountsKey(organizationId), queryFn: () => getPaymentAccounts(organizationId) });
}

export function useStartMercadoPagoConnect(organizationId: string) {
  return useMutation({ mutationFn: () => startMercadoPagoConnect(organizationId) });
}

export function useDisconnectMercadoPago(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectMercadoPago(organizationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountsKey(organizationId) }),
  });
}
