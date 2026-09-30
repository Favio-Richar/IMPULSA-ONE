"use client";

import type { PaymentAccountsResponse } from "@impulza/contracts";
import { Button, EmptyState, ErrorState, LoadingState, cn } from "@impulza/ui";
import { CheckCircle2, CircleAlert, ExternalLink, Info, Link2, ShieldCheck, Wallet, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { ConfirmButton } from "../../../components/confirm-button";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { billingErrorMessage, formatDate } from "../../../lib/billing-text";
import { useDisconnectMercadoPago, usePaymentAccounts, useStartMercadoPagoConnect } from "../../../lib/hooks/use-payment-accounts";

type Outcome = "conectada" | "cancelada" | "vencida" | "sin-permiso" | "error";

const OUTCOMES: Record<Outcome, { tone: "success" | "warning" | "danger"; title: string; body: string }> = {
  conectada: { tone: "success", title: "¡Listo! Tu cuenta de Mercado Pago quedó conectada", body: "Desde ahora tus clientes pueden pagar en tu página y el dinero llega directo a tu cuenta." },
  cancelada: { tone: "warning", title: "No se conectó la cuenta", body: "Cancelaste la autorización en Mercado Pago. Puedes intentarlo cuando quieras." },
  vencida: { tone: "warning", title: "El tiempo para conectar se agotó", body: "Pasaron más de 10 minutos o el enlace ya se usó. Vuelve a presionar «Conectar Mercado Pago»." },
  "sin-permiso": { tone: "danger", title: "No tienes permiso para conectar la cuenta", body: "Solo el dueño de la organización puede conectar la cuenta donde llega el dinero." },
  error: { tone: "danger", title: "No pudimos conectar la cuenta", body: "Mercado Pago no aceptó la autorización. Intenta de nuevo en unos minutos; si sigue pasando, escríbenos desde Soporte." },
};

const TONE = {
  success: { box: "border-success/30 bg-success/5", icon: <CheckCircle2 className="motion-pop size-6 text-success" aria-hidden="true" /> },
  warning: { box: "border-warning/40 bg-warning/5", icon: <CircleAlert className="size-6 text-warning" aria-hidden="true" /> },
  danger: { box: "border-danger/30 bg-danger/5", icon: <CircleAlert className="size-6 text-danger" aria-hidden="true" /> },
} as const;

export default function CobrosPage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para configurar sus cobros." />;
  }
  return (
    <Suspense fallback={<LoadingState label="Cargando tus cobros…" />}>
      <Cobros organizationId={organizationId} />
    </Suspense>
  );
}

/**
 * Cobros (F5.8, ADR-013): el negocio conecta SU cuenta de Mercado Pago y cobra en su página. El
 * dinero va directo a su cuenta: Impulza no lo toca ni cobra comisión.
 */
function Cobros({ organizationId }: { organizationId: string }): React.JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = searchParams.get("conexion");
  const outcome = raw && raw in OUTCOMES ? (raw as Outcome) : null;
  const accounts = usePaymentAccounts(organizationId);

  if (accounts.isPending) return <LoadingState label="Cargando tus cobros…" />;
  if (accounts.isError) return <ErrorState onRetry={() => accounts.refetch()} />;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-foreground">Cobros</h1>
        <p className="text-sm text-muted-foreground">
          Conecta tu cuenta de Mercado Pago para que tus clientes paguen pedidos y señas en tu página. El dinero llega directo a tu cuenta: Impulza One no
          lo recibe ni cobra comisión por tus ventas.
        </p>
      </div>

      {outcome ? <OutcomeBanner outcome={outcome} onDismiss={() => router.replace(pathname)} /> : null}

      <MercadoPagoCard organizationId={organizationId} data={accounts.data} />

      <section aria-labelledby="como-funciona" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h2 id="como-funciona" className="text-base font-semibold text-foreground">
          Cómo funciona
        </h2>
        <ul className="flex flex-col gap-3 text-sm text-foreground">
          <li className="flex gap-3">
            <Wallet className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            Tu cliente paga en el sitio seguro de Mercado Pago, con tarjeta o dinero en cuenta, y el pago llega a tu cuenta.
          </li>
          <li className="flex gap-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            El pedido o la reserva se marcan como pagados solos, cuando Mercado Pago confirma el pago.
          </li>
          <li className="flex gap-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            Impulza One nunca ve tarjetas. Guarda cifrado solo el permiso que tú das, y puedes desconectarlo cuando quieras.
          </li>
          <li className="flex gap-3">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            La venta es tuya: tú emites la boleta a tu cliente, como en cualquier venta de tu negocio.
          </li>
        </ul>
      </section>
    </div>
  );
}

function OutcomeBanner({ outcome, onDismiss }: { outcome: Outcome; onDismiss: () => void }): React.JSX.Element {
  const content = OUTCOMES[outcome];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), [outcome]);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={content.tone === "danger" ? "alert" : "status"}
      data-testid="connect-result"
      className={cn("motion-rise flex items-start gap-3 rounded-lg border p-4 focus:outline-none", TONE[content.tone].box)}
    >
      {TONE[content.tone].icon}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold text-foreground">{content.title}</p>
        <p className="text-sm text-foreground">{content.body}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar aviso"
        className="rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function MercadoPagoCard({ organizationId, data }: { organizationId: string; data: PaymentAccountsResponse }): React.JSX.Element {
  const connect = useStartMercadoPagoConnect(organizationId);
  const disconnect = useDisconnectMercadoPago(organizationId);
  const account = data.mercadoPago;

  function startConnect() {
    connect.mutate(undefined, { onSuccess: ({ url }) => window.location.assign(url) });
  }

  const state = !account ? "none" : account.status === "ERROR" ? "error" : "connected";

  return (
    <section aria-labelledby="mercado-pago" className="motion-rise flex flex-col gap-4 rounded-lg border border-border bg-background p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="mercado-pago" className="text-base font-semibold text-foreground">
            Mercado Pago
          </h2>
          <p className="text-sm text-muted-foreground">Tarjetas de crédito, débito y dinero en cuenta de Mercado Pago.</p>
        </div>
        <span
          data-testid="account-status"
          className={cn(
            "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
            state === "connected" ? "bg-success/5 text-success ring-success/25" : state === "error" ? "bg-danger/10 text-danger ring-danger/25" : "bg-surface text-muted-foreground ring-border",
          )}
        >
          {state === "connected" ? "Conectada" : state === "error" ? "Hay que reconectar" : "Sin conectar"}
        </span>
      </div>

      {account && state === "connected" ? (
        <p className="text-sm text-foreground">
          Conectada el {formatDate(account.connectedAt)}. {account.liveMode ? "Cobros reales." : "Cuenta de prueba de Mercado Pago: los cobros no mueven dinero real."}
        </p>
      ) : null}
      {state === "error" ? (
        <p className="text-sm text-foreground">
          Perdimos la conexión (se revocó el acceso o venció). Mientras no la reconectes, tu página ofrece tus enlaces de pago en vez del cobro automático.
        </p>
      ) : null}
      {!data.available && !account ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link2 className="size-4" aria-hidden="true" />
          La conexión con Mercado Pago todavía no está habilitada. Mientras tanto, puedes usar tus propios enlaces de pago en productos y servicios.
        </p>
      ) : null}

      {connect.isError || disconnect.isError ? (
        <p role="alert" className="text-sm text-danger">
          {billingErrorMessage(connect.error ?? disconnect.error)}
        </p>
      ) : null}

      {/* Desconectar está siempre al alcance del dueño (ADR-013: puede revocar el acceso cuando
          quiera), aunque este ambiente no permita conectar una cuenta nueva. */}
      {data.canManage && (data.available || account) ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {state !== "connected" && data.available ? (
            <Button onClick={startConnect} loading={connect.isPending} data-testid="connect-mercadopago">
              <ExternalLink className="size-4" aria-hidden="true" />
              {state === "error" ? "Reconectar Mercado Pago" : "Conectar Mercado Pago"}
            </Button>
          ) : null}
          {account ? (
            <ConfirmButton variant="secondary" confirmLabel="¿Desconectar? Tus clientes ya no podrán pagar en tu página." loading={disconnect.isPending} onConfirm={() => disconnect.mutate()}>
              Desconectar
            </ConfirmButton>
          ) : null}
        </div>
      ) : null}
      {!data.canManage ? <p className="border-t border-border pt-4 text-xs text-muted-foreground">Solo el dueño de la organización puede conectar o desconectar la cuenta.</p> : null}
    </section>
  );
}
