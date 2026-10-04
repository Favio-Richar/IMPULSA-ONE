"use client";

import type { AgencyDuplicateResponse, AgencyOverviewItem } from "@impulza/contracts";
import { Button, Input } from "@impulza/ui";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useDuplicateAgencyClient } from "../../lib/hooks/use-agency";
import { slugify } from "../../lib/slugify";
import { BILLING_TEXT, errorText } from "./agency-text";

type Mode = AgencyOverviewItem["billingMode"];

/** Solo donde la agencia puede leer el sitio del cliente: la misma regla que da acceso en el servidor. */
function canDuplicate(item: AgencyOverviewItem): boolean {
  return item.status === "ACTIVE" || item.status === "PAUSED" || item.status === "TRANSFERRING" || (item.status === "INVITED" && item.agencyCreated);
}

const REASON_TEXT = {
  unknown_type: "tipo de bloque desconocido",
  future_version: "versión de bloque más nueva que este sistema",
  invalid_after_cleanup: "quedaba incompleto sin las imágenes o recursos del cliente origen",
} as const;

function Report({ result }: { result: AgencyDuplicateResponse }): React.JSX.Element {
  const { report } = result;
  const omitted = report.skippedByPlan.sites + report.skippedByPlan.pages;
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3" data-testid="duplicate-report">
      <p role="status" className="flex items-start gap-2 text-sm text-foreground">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <span>
          {result.replayed ? "Este cliente ya se había creado con esa clave: " : "Creamos "}
          <strong>«{result.client.clientName}»</strong> con {report.sites} sitio{report.sites === 1 ? "" : "s"}, {report.pages} página{report.pages === 1 ? "" : "s"} y {report.blocks} bloque
          {report.blocks === 1 ? "" : "s"}
          {report.themes > 0 ? `, ${report.themes} tema${report.themes === 1 ? "" : "s"}` : ""}
          {report.brandColorsCopied ? " y los colores de marca" : ""}. Todo quedó en <strong>borrador</strong>: nada se publica solo. Invitamos a {result.client.ownerInviteEmail ?? "su propietario"}.
        </span>
      </p>

      {report.needsReview.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="duplicate-needs-review">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <TriangleAlert className="size-4 text-warning" aria-hidden="true" /> Revisa antes de publicar
          </p>
          <p className="text-xs text-muted-foreground">Estos datos vienen del negocio origen y casi seguro no son los del cliente nuevo:</p>
          <ul className="list-disc pl-5 text-xs text-foreground">
            {report.needsReview.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.imagesRemoved > 0 || report.referencesCleared > 0 || omitted > 0 || report.blocksSkipped.length > 0 || report.smartCtaRulesDropped > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground" data-testid="duplicate-adjustments">
          {report.imagesRemoved > 0 ? <li>{report.imagesRemoved === 1 ? "1 imagen de la biblioteca del cliente origen no se copió: súbela de nuevo." : `${report.imagesRemoved} imágenes de la biblioteca del cliente origen no se copiaron: súbelas de nuevo.`}</li> : null}
          {report.referencesCleared > 0 ? <li>{report.referencesCleared} bloque{report.referencesCleared === 1 ? "" : "s"} apuntaba{report.referencesCleared === 1 ? "" : "n"} a un formulario, servicios o productos del origen y quedó sin configurar.</li> : null}
          {report.skippedByPlan.sites > 0 ? <li>{report.skippedByPlan.sites} sitio{report.skippedByPlan.sites === 1 ? "" : "s"} no se copió: el plan del cliente nuevo no lo permite.</li> : null}
          {report.skippedByPlan.pages > 0 ? <li>{report.skippedByPlan.pages} página{report.skippedByPlan.pages === 1 ? "" : "s"} no se copió: el plan del cliente nuevo no lo permite.</li> : null}
          {report.blocksSkipped.map((block, index) => (
            <li key={`${block.type}-${index}`}>Un bloque «{block.type}» no se copió: {REASON_TEXT[block.reason]}.</li>
          ))}
          {report.smartCtaRulesDropped > 0 ? <li>{report.smartCtaRulesDropped} regla{report.smartCtaRulesDropped === 1 ? "" : "s"} del botón inteligente se descartó porque apuntaba a un bloque que no se copió.</li> : null}
        </ul>
      ) : null}

      <details className="rounded-md border border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Qué NO se copia nunca
        </summary>
        <ul className="list-disc px-8 pb-3 pt-1 text-xs text-muted-foreground">
          {report.notCopied.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * Duplicar un cliente en una organización nueva (F9.5c): copia sitios, páginas, bloques, temas y colores de marca, en borrador. Nunca
 * copia contactos, pedidos, pagos, claves ni los archivos del cliente origen. El intento lleva una clave de idempotencia fija mientras
 * el panel está abierto: un doble clic o un reintento tras un corte no crea dos clientes.
 */
export function ClientDuplicate({ organizationId, item }: { organizationId: string; item: AgencyOverviewItem }): React.JSX.Element | null {
  const duplicate = useDuplicateAgencyClient(organizationId, item.id);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [billingMode, setBillingMode] = useState<Mode>("CLIENT_PAYS");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<AgencyDuplicateResponse | null>(null);

  if (!canDuplicate(item)) return null;

  const canSubmit = name.trim().length >= 2 && slug.trim() !== "" && ownerEmail.trim() !== "";

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="client-duplicate">
      {!open ? (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setResult(null);
              setOpen(true);
            }}
          >
            Duplicar en un cliente nuevo
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3" role="group" aria-label="Duplicar en un cliente nuevo">
          <p className="text-sm text-foreground">
            Crea un cliente <strong>nuevo</strong> con el sitio de «{item.clientName}»: páginas, bloques, temas y colores de marca, en borrador.
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
            <li>No se copian contactos, respuestas, pedidos, reservas, pagos, claves ni cuentas de cobro.</li>
            <li>Tampoco las imágenes ni los videos de su biblioteca, sus dominios ni sus identificadores de medición.</li>
            <li>Los bloques que usaban sus formularios, servicios o productos quedan sin configurar.</li>
            <li>Su plan limita cuántos sitios y páginas caben; te diremos qué quedó fuera.</li>
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Nombre del cliente nuevo"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
            />
            <Input
              label="Identificador del cliente nuevo"
              helperText="Minúsculas, números y guiones. No se puede repetir."
              value={slug}
              onChange={(event) => {
                setSlug(event.target.value);
                setSlugTouched(true);
              }}
            />
            <Input label="Correo de su propietario" type="email" autoComplete="off" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Quién paga el plan</span>
              <select
                aria-label="Quién paga el plan del cliente nuevo"
                className="h-10 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground"
                value={billingMode}
                onChange={(event) => setBillingMode(event.target.value as Mode)}
              >
                {(Object.keys(BILLING_TEXT) as Mode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {BILLING_TEXT[mode]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {duplicate.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorText(duplicate.error, "No pudimos duplicar el cliente. No se creó nada: puedes intentarlo de nuevo.")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={duplicate.isPending}
              disabled={!canSubmit}
              onClick={() =>
                duplicate.mutate(
                  { name: name.trim(), slug: slug.trim(), ownerEmail: ownerEmail.trim(), billingMode, idempotencyKey: key },
                  {
                    onSuccess: (response) => {
                      setResult(response);
                      setOpen(false);
                      setName("");
                      setSlug("");
                      setSlugTouched(false);
                      setOwnerEmail("");
                      setKey(crypto.randomUUID());
                    },
                  },
                )
              }
            >
              Crear el cliente duplicado
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {result ? <Report result={result} /> : null}
    </div>
  );
}
