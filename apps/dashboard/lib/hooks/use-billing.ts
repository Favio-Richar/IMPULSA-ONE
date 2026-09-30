import type { StartCheckoutInput } from "@impulza/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelSubscription, getBilling, resumeSubscription, startCheckout, withdrawSubscription } from "../api/billing";

function billingKey(organizationId: string) {
  return ["billing", organizationId] as const;
}

/**
 * Suscripción, pagos y pasarelas (F4.6c). Mientras un pago está "en confirmación" (el cobro quedó
 * sin respuesta y lo concilia el worker) se consulta cada 10 s hasta que se resuelva.
 */
export function useBilling(organizationId: string, options: { pollWhilePending?: boolean } = {}) {
  return useQuery({
    queryKey: billingKey(organizationId),
    queryFn: () => getBilling(organizationId),
    refetchInterval: (query) => {
      if (!options.pollWhilePending) return false;
      const status = query.state.data?.subscription?.status;
      const pendingPayment = query.state.data?.payments.some((payment) => payment.status === "PENDING");
      return status === "INCOMPLETE" || pendingPayment || !query.state.data?.subscription ? 10_000 : false;
    },
  });
}

/** Cambios que mueven el plan efectivo: se refresca también el plan efectivo y su uso. */
function useInvalidateBilling(organizationId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: billingKey(organizationId) }),
      queryClient.invalidateQueries({ queryKey: ["organization-plan", organizationId] }),
    ]);
}

export function useStartCheckout(organizationId: string) {
  return useMutation({ mutationFn: (body: StartCheckoutInput) => startCheckout(organizationId, body) });
}

export function useCancelSubscription(organizationId: string) {
  const invalidate = useInvalidateBilling(organizationId);
  return useMutation({ mutationFn: () => cancelSubscription(organizationId), onSuccess: invalidate });
}

export function useResumeSubscription(organizationId: string) {
  const invalidate = useInvalidateBilling(organizationId);
  return useMutation({ mutationFn: () => resumeSubscription(organizationId), onSuccess: invalidate });
}

export function useWithdrawSubscription(organizationId: string) {
  const invalidate = useInvalidateBilling(organizationId);
  return useMutation({ mutationFn: () => withdrawSubscription(organizationId), onSuccess: invalidate });
}
