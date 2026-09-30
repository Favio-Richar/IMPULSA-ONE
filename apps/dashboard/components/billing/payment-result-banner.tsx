"use client";

import { cn } from "@impulza/ui";
import { CheckCircle2, CircleAlert, Clock3, X, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { PAYMENT_OUTCOMES, type PaymentOutcome } from "../../lib/billing-text";

const TONE_STYLES = {
  success: "border-success/30 bg-success/10",
  info: "border-info/30 bg-info/10",
  warning: "border-warning/30 bg-warning/10",
  danger: "border-danger/30 bg-danger/10",
} as const;

const TONE_ICON = {
  success: <CheckCircle2 className="motion-pop size-6 text-success" aria-hidden="true" />,
  info: <Clock3 className="size-6 text-info" aria-hidden="true" />,
  warning: <CircleAlert className="size-6 text-warning" aria-hidden="true" />,
  danger: <XCircle className="size-6 text-danger" aria-hidden="true" />,
} as const;

/**
 * Resultado al volver de Webpay (`/plan?pago=…`). Recibe el foco al aparecer para que un lector de
 * pantalla lo anuncie primero: es lo único que la persona necesita saber en ese momento.
 */
export function PaymentResultBanner({ outcome, onDismiss }: { outcome: PaymentOutcome; onDismiss: () => void }): React.JSX.Element {
  const content = PAYMENT_OUTCOMES[outcome];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, [outcome]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role={content.tone === "danger" ? "alert" : "status"}
      data-testid="payment-result"
      className={cn("motion-rise flex items-start gap-3 rounded-lg border p-4 focus:outline-none", TONE_STYLES[content.tone])}
    >
      {TONE_ICON[content.tone]}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold text-foreground">{content.title}</p>
        <p className="text-sm text-foreground">{content.body}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        aria-label="Cerrar aviso"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
