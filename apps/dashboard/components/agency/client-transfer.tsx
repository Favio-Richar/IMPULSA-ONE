"use client";

import type { AgencyOverviewItem } from "@impulza/contracts";
import { Button, Input } from "@impulza/ui";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useCancelAgencyTransfer, useStartAgencyTransfer } from "../../lib/hooks/use-agency";
import { errorText } from "./agency-text";

const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" });
const WAITING_TEXT = { OWNER: "el propietario", RECEIVER: "la agencia receptora" } as const;

/**
 * Traspasar un cliente, desde la fila de la agencia (F9.5b): a su propietario o a otra agencia. Doble consentimiento: el propietario
 * siempre decide y, si es a otra agencia, ella también. Mientras tanto nada cambia y el traspaso vence en 14 días.
 */
export function ClientTransfer({ organizationId, item }: { organizationId: string; item: AgencyOverviewItem }): React.JSX.Element | null {
  const start = useStartAgencyTransfer(organizationId, item.id);
  const cancel = useCancelAgencyTransfer(organizationId, item.id);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<"OWNER" | "AGENCY">("OWNER");
  const [agencySlug, setAgencySlug] = useState("");
  const [agencyOwnerEmail, setAgencyOwnerEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const pending = item.pendingTransfer;
  if (!pending && item.status !== "ACTIVE") return null;

  const canSubmit = target === "OWNER" || (agencySlug.trim() !== "" && agencyOwnerEmail.trim() !== "");

  if (pending) {
    return (
      <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="client-transfer">
        <p className="text-sm text-foreground" data-testid="client-transfer-pending">
          Traspaso en curso {pending.toKind === "OWNER" ? "a su propietario" : `a «${pending.toAgencyName ?? "otra agencia"}»`}
          <span className="text-muted-foreground">
            {" "}
            · esperando a {pending.waitingFor.map((party) => WAITING_TEXT[party]).join(" y ")} · vence el {dateFormat.format(new Date(pending.expiresAt))}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">Mientras tanto nada cambia: sigues trabajando con este cliente.</p>
        <div>
          <Button size="sm" variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate(undefined, { onSuccess: () => setDone("Cancelaste el traspaso.") })}>
            Cancelar traspaso
          </Button>
        </div>
        {cancel.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorText(cancel.error, "No pudimos cancelar el traspaso.")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="client-transfer">
      {!open ? (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDone(null);
              setOpen(true);
            }}
          >
            Traspasar este cliente
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3" role="group" aria-label="Traspasar este cliente">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-foreground">¿A quién se lo traspasas?</legend>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="radio" name={`transfer-target-${item.id}`} className="mt-0.5 size-4" checked={target === "OWNER"} onChange={() => setTarget("OWNER")} />
              <span>
                A su propietario
                <span className="block text-xs text-muted-foreground">Tu agencia deja de administrar este negocio y queda en manos de su dueño.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="radio" name={`transfer-target-${item.id}`} className="mt-0.5 size-4" checked={target === "AGENCY"} onChange={() => setTarget("AGENCY")} />
              <span>
                A otra agencia
                <span className="block text-xs text-muted-foreground">Pasa a la agencia que indiques. Solo se completa si su propietario Y esa agencia aceptan.</span>
              </span>
            </label>
          </fieldset>

          {target === "AGENCY" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Identificador de la agencia" value={agencySlug} onChange={(event) => setAgencySlug(event.target.value)} />
              <Input label="Correo del propietario de esa agencia" type="email" autoComplete="off" value={agencyOwnerEmail} onChange={(event) => setAgencyOwnerEmail(event.target.value)} />
            </div>
          ) : null}

          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
            <li>Nada cambia hasta que acepten: sigues trabajando con este cliente. Vence en 14 días.</li>
            <li>Los datos del negocio no se borran ni se mueven: solo cambia quién lo administra.</li>
            {item.billingMode === "AGENCY_PAYS" ? <li>Hoy pagas tú su plan: al completarse, deja de regir.</li> : null}
          </ul>

          {start.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorText(start.error, "No pudimos iniciar el traspaso.")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={start.isPending}
              disabled={!canSubmit}
              onClick={() =>
                start.mutate(target === "OWNER" ? { to: "OWNER" } : { to: "AGENCY", agencySlug: agencySlug.trim(), agencyOwnerEmail: agencyOwnerEmail.trim() }, {
                  onSuccess: () => {
                    setOpen(false);
                    setDone("Traspaso propuesto: queda pendiente de las partes.");
                  },
                })
              }
            >
              Proponer traspaso
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {done ? (
        <p role="status" className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" /> {done}
        </p>
      ) : null}
    </div>
  );
}
