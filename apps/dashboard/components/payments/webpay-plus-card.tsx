"use client";

import type { PaymentAccountsResponse } from "@impulza/contracts";
import { Button, Input, cn } from "@impulza/ui";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { ConfirmButton } from "../confirm-button";
import { billingErrorMessage, formatDate } from "../../lib/billing-text";
import { useConnectWebpayPlus, useDisconnectWebpayPlus } from "../../lib/hooks/use-payment-accounts";

/**
 * Webpay Plus con las credenciales PROPIAS del negocio (F10.2c, ADR-030). El dinero va directo a su comercio de Transbank; Impulza no lo
 * recibe. La llave secreta se escribe una sola vez: nunca se muestra de vuelta ni se guarda en el navegador.
 */
export function WebpayPlusCard({ organizationId, data }: { organizationId: string; data: PaymentAccountsResponse }): React.JSX.Element {
  const connect = useConnectWebpayPlus(organizationId);
  const disconnect = useDisconnectWebpayPlus(organizationId);
  const account = data.webpayPlus;
  const [editing, setEditing] = useState(false);
  const [commerceCode, setCommerceCode] = useState("");
  const [apiKeySecret, setApiKeySecret] = useState("");
  const [environment, setEnvironment] = useState<"integration" | "production">("production");
  const [invalid, setInvalid] = useState<{ commerceCode?: string; apiKeySecret?: string } | null>(null);

  const state = !account ? "none" : account.status === "ERROR" ? "error" : "connected";
  const showForm = data.canManage && (state !== "connected" || editing);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const errors: { commerceCode?: string; apiKeySecret?: string } = {};
    if (!/^\d{12}$/.test(commerceCode.trim())) errors.commerceCode = "El código de comercio tiene 12 dígitos.";
    if (apiKeySecret.trim().length < 32) errors.apiKeySecret = "La llave secreta es más larga: cópiala completa desde Transbank.";
    setInvalid(Object.keys(errors).length > 0 ? errors : null);
    if (Object.keys(errors).length > 0) return;
    connect.mutate(
      { commerceCode: commerceCode.trim(), apiKeySecret: apiKeySecret.trim(), environment },
      {
        onSuccess: () => {
          // La llave no se conserva ni un instante más de lo necesario.
          setApiKeySecret("");
          setCommerceCode("");
          setEditing(false);
        },
      },
    );
  }

  return (
    <section aria-labelledby="webpay-plus" className="motion-rise flex flex-col gap-4 rounded-lg border border-border bg-background p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="webpay-plus" className="text-base font-semibold text-foreground">
            Webpay Plus (Transbank)
          </h2>
          <p className="text-sm text-muted-foreground">Tarjetas de crédito y débito chilenas. Usa el código de comercio que Transbank te entregó a ti.</p>
        </div>
        <span
          data-testid="webpay-status"
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
          Comercio terminado en <span className="font-medium">{account.commerceCodeLast4}</span>, conectado el {formatDate(account.connectedAt)}.{" "}
          {account.liveMode ? "Cobros reales." : "Ambiente de pruebas de Transbank: los cobros no mueven dinero real."}
        </p>
      ) : null}

      {!account ? (
        <p className="text-sm text-muted-foreground">
          Para cobrar con Webpay necesitas contratar Webpay Plus con Transbank (es un trámite tuyo con ellos). Cuando tengas tu código de comercio y tu llave secreta, ingrésalos acá.
          Impulza One los guarda cifrados y no recibe tu dinero ni cobra comisión por tus ventas.
        </p>
      ) : null}

      {showForm ? (
        <form noValidate onSubmit={submit} aria-label="Conectar Webpay Plus" className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Código de comercio"
              inputMode="numeric"
              autoComplete="off"
              value={commerceCode}
              onChange={(event) => setCommerceCode(event.target.value)}
              error={invalid?.commerceCode}
              helperText="12 dígitos."
              required
            />
            <Input
              label="Llave secreta"
              type="password"
              autoComplete="off"
              value={apiKeySecret}
              onChange={(event) => setApiKeySecret(event.target.value)}
              error={invalid?.apiKeySecret}
              helperText="No se muestra después de guardarla."
              required
            />
          </div>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Ambiente
            <select value={environment} onChange={(event) => setEnvironment(event.target.value as typeof environment)} className="min-h-10 rounded-md border border-border bg-background px-2 text-sm">
              <option value="production">Producción (cobros reales)</option>
              <option value="integration">Pruebas (ambiente de integración de Transbank)</option>
            </select>
          </label>
          {connect.isError ? (
            <p role="alert" className="text-sm text-danger">
              {billingErrorMessage(connect.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={connect.isPending} data-testid="connect-webpay">
              <KeyRound className="size-4" aria-hidden="true" />
              {state === "none" ? "Conectar Webpay Plus" : "Guardar credenciales"}
            </Button>
            {editing ? (
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      {data.canManage && account ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {state === "connected" && !editing ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Cambiar credenciales
            </Button>
          ) : null}
          <ConfirmButton
            variant="secondary"
            confirmLabel="¿Desconectar? Tus clientes ya no podrán pagar con Webpay en tu página."
            loading={disconnect.isPending}
            onConfirm={() => disconnect.mutate()}
            data-testid="disconnect-webpay"
          >
            Desconectar
          </ConfirmButton>
        </div>
      ) : null}
      {disconnect.isError ? (
        <p role="alert" className="text-sm text-danger">
          {billingErrorMessage(disconnect.error)}
        </p>
      ) : null}
      {!data.canManage ? <p className="border-t border-border pt-4 text-xs text-muted-foreground">Solo el dueño de la organización puede conectar o desconectar Webpay Plus.</p> : null}
    </section>
  );
}
