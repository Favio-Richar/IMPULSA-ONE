"use client";

import type { CampaignResponse } from "@impulza/contracts";
import {
  campaignEmail,
  campaignSchema,
  CONTACT_COMMERCIAL_STATUS_LABELS,
  CONTACT_COMMERCIAL_STATUS_VALUES,
  type CampaignSegment,
} from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Input } from "@impulza/ui";
import { Check, Send, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useSites } from "../../lib/hooks/use-sites";
import {
  useCampaignAudience,
  useCampaignSegmentOptions,
  useCreateCampaign,
  useDeleteCampaign,
  useSendCampaign,
  useSendCampaignTest,
  useUpdateCampaign,
} from "../../lib/hooks/use-campaigns";
import { RichTextEditor } from "../block-editor/rich-text-editor";
import { ConfirmButton } from "../confirm-button";

const EMPTY_SEGMENT: CampaignSegment = { tags: [], sources: [], commercialStatuses: [] };

interface Draft {
  name: string;
  subject: string;
  bodyHtml: string;
  segment: CampaignSegment;
}

const SOURCE_KINDS: Record<string, string> = { order: "Pedido", booking: "Reserva", form: "Formulario" };

/** "order:<sitio>" → "Pedido · Tienda Lumen": el origen tal como lo entiende una persona. */
export function sourceLabel(source: string, siteNames: ReadonlyMap<string, string>): string {
  const [kind, id] = source.split(":", 2);
  const label = kind ? SOURCE_KINDS[kind] : undefined;
  if (!label) return source === "manual" ? "Cargado a mano" : source;
  const site = id ? siteNames.get(id) : undefined;
  return site ? `${label} · ${site}` : label;
}

function apiMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 403) return "Tu rol no permite crear ni enviar campañas (solo dueños y administradores).";
  if (error instanceof ApiError && error.status === 429) return "Hiciste muchas pruebas seguidas. Espera unos minutos.";
  const body = error instanceof ApiError ? (error.body as { message?: unknown } | undefined) : undefined;
  return typeof body?.message === "string" ? body.message : fallback;
}

/** Botones que se prenden y apagan (etiquetas, fuentes, estados): elegir varios suma, no resta. */
function ChipGroup<T extends string>({
  label,
  options,
  selected,
  onChange,
  format = (value) => value,
  empty,
}: {
  label: string;
  options: readonly T[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  format?: (value: T) => string;
  empty: string;
}): React.JSX.Element {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-foreground">{label}</legend>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const active = selected.includes(option);
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(active ? selected.filter((value) => value !== option) : [...selected, option])}
                className={cn(
                  "inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-background text-foreground hover:bg-surface",
                )}
              >
                {active ? <Check className="size-3.5" aria-hidden="true" /> : null}
                {format(option)}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Editor de campaña (F5.6): texto a la izquierda, a la derecha a quién le llega (con el conteo en
 * vivo, que ya descuenta a quien no aceptó o se dio de baja) y la vista previa con el pie fijo de
 * baja. Probar y enviar piden los cambios guardados: se prueba y se envía lo que está en el servidor.
 */
export function CampaignEditor({ organizationId, campaign }: { organizationId: string; campaign?: CampaignResponse }): React.JSX.Element {
  const router = useRouter();
  const initial: Draft = campaign
    ? { name: campaign.name, subject: campaign.subject, bodyHtml: campaign.bodyHtml, segment: campaign.segment }
    : { name: "", subject: "", bodyHtml: "", segment: EMPTY_SEGMENT };
  const [draft, setDraft] = useState<Draft>(initial);
  const [saved, setSaved] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const options = useCampaignSegmentOptions(organizationId);
  const sites = useSites(organizationId);
  const siteNames = useMemo(() => new Map((sites.data ?? []).map((site) => [site.id, site.name])), [sites.data]);
  const audience = useCampaignAudience(organizationId, draft.segment);
  const create = useCreateCampaign(organizationId);
  const update = useUpdateCampaign(organizationId, campaign?.id ?? "");
  const remove = useDeleteCampaign(organizationId);
  const test = useSendCampaignTest(organizationId, campaign?.id ?? "");
  const send = useSendCampaign(organizationId, campaign?.id ?? "");

  const preview = useMemo(
    () => campaignEmail({ organizationName: "Tu negocio", subject: draft.subject || "(sin asunto)", bodyHtml: draft.bodyHtml, unsubscribeUrl: "#baja" }),
    [draft.subject, draft.bodyHtml],
  );
  const set = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
  const setSegment = (changes: Partial<CampaignSegment>) => set({ segment: { ...draft.segment, ...changes } });
  const eligible = audience.data?.eligible;

  async function save(event?: React.FormEvent): Promise<void> {
    event?.preventDefault();
    setNotice(null);
    const parsed = campaignSchema.safeParse(draft);
    if (!parsed.success || draft.bodyHtml.replace(/<[^>]+>/g, "").trim() === "") {
      setError(!draft.name.trim() ? "Ponle un nombre a la campaña." : !draft.subject.trim() ? "Escribe el asunto del correo." : "Escribe el contenido del correo.");
      return;
    }
    setError(null);
    try {
      if (campaign) {
        const result = await update.mutateAsync(parsed.data);
        const next = { name: result.name, subject: result.subject, bodyHtml: result.bodyHtml, segment: result.segment };
        setDraft(next);
        setSaved(next);
        setNotice("Cambios guardados.");
      } else {
        const created = await create.mutateAsync(parsed.data);
        router.replace(`/campanas/${created.id}`);
      }
    } catch (caught) {
      setError(apiMessage(caught, "No se pudo guardar. Intenta de nuevo."));
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6" aria-label={campaign ? `Editar ${campaign.name}` : "Nueva campaña"}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/campanas" className="text-sm text-muted-foreground hover:underline">
            ← Campañas
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-foreground">{campaign ? campaign.name : "Nueva campaña"}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {campaign ? (
            <ConfirmButton
              type="button"
              variant="ghost"
              size="sm"
              confirmLabel="¿Borrar el borrador?"
              loading={remove.isPending}
              onConfirm={() => remove.mutate(campaign.id, { onSuccess: () => router.replace("/campanas"), onError: (caught) => setError(apiMessage(caught, "No se pudo borrar.")) })}
            >
              Borrar
            </ConfirmButton>
          ) : null}
          <Button type="submit" variant={campaign ? "secondary" : "primary"} size="sm" loading={create.isPending || update.isPending} disabled={campaign ? !dirty : false}>
            {campaign ? (dirty ? "Guardar cambios" : "Guardado") : "Guardar borrador"}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-foreground">
          {notice}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Contenido</CardTitle>
            <CardDescription>Lo que verán tus clientes. El pie con tu nombre y el enlace de baja se agrega solo.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Input label="Nombre interno" placeholder="Promo de otoño" helperText="Solo lo ves tú." value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required />
            <Input label="Asunto" placeholder="Llegaron las velas de otoño" value={draft.subject} onChange={(e) => set({ subject: e.target.value })} maxLength={150} required />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                Mensaje <span className="text-danger">*</span>
              </span>
              <div className="rounded-md border border-border-strong bg-background">
                <RichTextEditor value={draft.bodyHtml} onChange={(html) => set({ bodyHtml: html })} placeholder="Cuéntales la novedad…" ariaLabel="Mensaje del correo" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>¿A quién le llega?</CardTitle>
              <CardDescription>Sin filtros, a todos los que aceptaron recibir correos. Con filtros, a los que cumplan todos.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3" aria-live="polite">
                <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Users className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-base font-semibold tabular-nums text-foreground" data-audience="">
                    {eligible === undefined ? "…" : `${eligible.toLocaleString("es-CL")} ${eligible === 1 ? "contacto" : "contactos"}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {audience.data
                      ? `${audience.data.withMarketingConsent.toLocaleString("es-CL")} de tus ${audience.data.totalContacts.toLocaleString("es-CL")} contactos aceptaron recibir correos`
                      : audience.isError
                        ? "No se pudo calcular."
                        : "Calculando…"}
                  </p>
                </div>
              </div>
              <ChipGroup
                label="Etiquetas"
                options={options.data?.tags ?? []}
                selected={draft.segment.tags}
                onChange={(tags) => setSegment({ tags })}
                empty="Tus contactos todavía no tienen etiquetas."
              />
              <ChipGroup
                label="Estado comercial"
                options={CONTACT_COMMERCIAL_STATUS_VALUES}
                selected={draft.segment.commercialStatuses}
                onChange={(commercialStatuses) => setSegment({ commercialStatuses })}
                format={(value) => CONTACT_COMMERCIAL_STATUS_LABELS[value]}
                empty=""
              />
              <ChipGroup
                label="Origen"
                options={options.data?.sources ?? []}
                selected={draft.segment.sources}
                onChange={(sources) => setSegment({ sources })}
                format={(value) => sourceLabel(value, siteNames)}
                empty="Sin orígenes registrados."
              />
            </CardContent>
          </Card>

          {campaign ? (
            <Card>
              <CardHeader>
                <CardTitle>Probar y enviar</CardTitle>
                <CardDescription>
                  {dirty ? "Guarda los cambios para probar o enviar." : "La prueba te llega a ti. El envío sale de a poco, según el límite por hora de tu plan."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  loading={test.isPending}
                  disabled={dirty}
                  onClick={() =>
                    test.mutate(undefined, {
                      onSuccess: () => {
                        setError(null);
                        setNotice("Te enviamos la prueba a tu correo.");
                      },
                      onError: (caught) => setError(apiMessage(caught, "No se pudo enviar la prueba.")),
                    })
                  }
                >
                  Enviarme una prueba
                </Button>
                <ConfirmButton
                  type="button"
                  className="w-full"
                  disabled={dirty || !eligible}
                  confirmLabel={`¿Enviar a ${eligible ?? 0}?`}
                  loading={send.isPending}
                  onConfirm={() =>
                    send.mutate(undefined, {
                      onError: (caught) => setError(apiMessage(caught, "No se pudo iniciar el envío.")),
                    })
                  }
                >
                  <Send className="size-4" aria-hidden="true" />
                  {eligible ? `Enviar a ${eligible.toLocaleString("es-CL")} ${eligible === 1 ? "contacto" : "contactos"}` : "Nadie para enviar"}
                </ConfirmButton>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vista previa</CardTitle>
          <CardDescription>
            Asunto: <span className="font-medium text-foreground">{preview.subject}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* HTML ya saneado por el servidor al guardar; acá se muestra en un iframe aislado, sin scripts. */}
          <iframe title="Vista previa del correo" sandbox="" srcDoc={preview.html} className="h-96 w-full rounded-md border border-border bg-white" />
        </CardContent>
      </Card>
    </form>
  );
}
