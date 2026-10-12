"use client";

import type { MarketplaceOrganizationResponse, MarketplaceSubmissionResponse } from "@impulza/contracts";
import { MARKETPLACE_KIND_LABELS, MARKETPLACE_STATUS_LABELS, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENT_TYPES, type MarketplaceKind, type MarketplaceStatus } from "@impulza/validation";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { listBlocks } from "../../lib/api/blocks";
import { getMarketplace, installListing, submitListing, uninstallListing, withdrawListing, type SubmitIntegration, type SubmitTemplate } from "../../lib/api/marketplace";
import { usePages } from "../../lib/hooks/use-pages";
import { useSites } from "../../lib/hooks/use-sites";
import { useThemes } from "../../lib/hooks/use-themes";
import { ConfirmButton } from "../confirm-button";

type Listing = MarketplaceOrganizationResponse["directory"][number];

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Tu rol no permite hacer esto en el marketplace.";
    if (typeof error.body === "object" && error.body !== null) {
      const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
      if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
      if (typeof body.message === "string") return body.message;
    }
  }
  return fallback;
}

const selectClass = "min-h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground";
const STATUS_STYLE: Record<MarketplaceStatus, string> = {
  IN_REVIEW: "bg-warning/10 text-foreground",
  APPROVED: "bg-primary/10 text-primary",
  REJECTED: "bg-danger/10 text-danger",
  WITHDRAWN: "bg-muted text-muted-foreground",
};

/** Marketplace de la organización (F10.6): directorio con instalación reversible y publicaciones propias. */
export function MarketplacePanel({ organizationId }: { organizationId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const key = ["marketplace", organizationId];
  const query = useQuery({ queryKey: key, queryFn: () => getMarketplace(organizationId) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const [filter, setFilter] = useState<MarketplaceKind | "ALL">("ALL");

  if (query.isPending) return <LoadingState label="Cargando el marketplace…" />;
  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.status === 403;
    return forbidden ? (
      <ErrorState title="No tienes acceso" description="Instalar integraciones y plantillas lo hacen el propietario y los administradores." />
    ) : (
      <ErrorState onRetry={() => query.refetch()} />
    );
  }
  const items = query.data.directory.filter((item) => filter === "ALL" || item.kind === filter);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="directorio" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="directorio" className="text-lg font-semibold text-foreground">
            Directorio
          </h2>
          <div role="group" aria-label="Filtrar por tipo" className="flex gap-2">
            {(["ALL", "TEMPLATE", "INTEGRATION"] as const).map((value) => (
              <Button key={value} type="button" size="sm" variant={filter === value ? "primary" : "secondary"} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {value === "ALL" ? "Todo" : value === "TEMPLATE" ? "Plantillas" : "Integraciones"}
              </Button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Todo lo que ves está revisado por la plataforma. Una plantilla se suma a tus plantillas propias; una integración envía eventos de tu negocio a la dirección que tú pegues. Puedes quitar
          cualquiera cuando quieras: lo que ya aplicaste en tus páginas no cambia.
        </p>
        {items.length === 0 ? (
          <EmptyState title="Todavía no hay publicaciones aprobadas" description="Cuando la plataforma apruebe plantillas e integraciones de socios, aparecerán aquí." />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} organizationId={organizationId} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mis-publicaciones" className="flex flex-col gap-4">
        <h2 id="mis-publicaciones" className="text-lg font-semibold text-foreground">
          Tus publicaciones
        </h2>
        <p className="text-sm text-muted-foreground">Publica una plantilla o una integración tuya. Pasa por revisión antes de aparecer en el directorio.</p>
        {query.data.submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no has publicado nada.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
            {query.data.submissions.map((submission) => (
              <SubmissionRow key={submission.id} submission={submission} organizationId={organizationId} onChanged={refresh} />
            ))}
          </ul>
        )}
        <SubmitForm organizationId={organizationId} onSubmitted={refresh} />
      </section>
    </div>
  );
}

function ListingCard({ listing, organizationId, onChanged }: { listing: Listing; organizationId: string; onChanged: () => void }): React.JSX.Element {
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const install = useMutation({
    mutationFn: () => installListing(organizationId, listing.id, listing.kind === "INTEGRATION" ? { webhookUrl: url.trim() } : {}),
    onSuccess: (result) => {
      setSecret(result.secret);
      setUrl("");
      onChanged();
    },
  });
  const uninstall = useMutation({
    mutationFn: () => uninstallListing(organizationId, listing.id),
    onSuccess: () => {
      setSecret(null);
      onChanged();
    },
  });

  async function copySecret(): Promise<void> {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{listing.name}</p>
          <p className="text-xs text-muted-foreground">
            {MARKETPLACE_KIND_LABELS[listing.kind]} · {listing.partnerName}
            {listing.partnerUrl ? (
              <>
                {" "}
                ·{" "}
                <a href={listing.partnerUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  sitio del socio
                </a>
              </>
            ) : null}{" "}
            · v{listing.version}
          </p>
        </div>
        {listing.install.installed ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Instalada</span> : null}
      </div>
      <p className="text-sm text-foreground">{listing.summary}</p>
      <p className="text-sm text-muted-foreground">{listing.description}</p>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Qué pide</p>
        <ul className="mt-1 list-disc pl-5 text-sm text-foreground">
          {listing.permissions.map((permission) => (
            <li key={permission}>{permission}</li>
          ))}
        </ul>
      </div>
      {listing.instructions ? <p className="rounded-md bg-muted p-2 text-sm text-foreground">{listing.instructions}</p> : null}

      {secret ? (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm text-foreground">
          <p>Guarda esta clave de firma ahora: no se vuelve a mostrar.</p>
          <code className="break-all rounded bg-muted p-2 text-xs">{secret}</code>
          <div>
            <Button type="button" size="sm" variant="secondary" onClick={() => void copySecret()}>
              {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
              {copied ? "Copiada" : "Copiar clave"}
            </Button>
          </div>
        </div>
      ) : null}

      {listing.install.updateAvailable ? (
        <p className="text-xs text-muted-foreground">
          Hay una versión nueva ({listing.version}); tienes la {listing.install.installedVersion}. Para tomarla, desinstala e instala de nuevo.
        </p>
      ) : null}

      {listing.install.installed ? (
        <div>
          <ConfirmButton variant="secondary" size="sm" confirmLabel="¿Desinstalar? Lo que ya aplicaste no cambia." loading={uninstall.isPending} onConfirm={() => uninstall.mutate()}>
            <Trash2 className="size-4" aria-hidden="true" /> Desinstalar
          </ConfirmButton>
        </div>
      ) : (
        <form
          noValidate
          aria-label={`Instalar ${listing.name}`}
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            install.mutate();
          }}
        >
          {listing.kind === "INTEGRATION" ? (
            <Input label="Dirección de destino" value={url} placeholder="https://hooks.zapier.com/…" onChange={(event) => setUrl(event.target.value)} required />
          ) : null}
          <div>
            <Button type="submit" size="sm" loading={install.isPending} disabled={listing.kind === "INTEGRATION" && url.trim().length === 0}>
              <Download className="size-4" aria-hidden="true" /> Instalar
            </Button>
          </div>
        </form>
      )}
      {install.isError || uninstall.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorText(install.error ?? uninstall.error, "No pudimos completar la acción. Intenta de nuevo.")}
        </p>
      ) : null}
    </li>
  );
}

function SubmissionRow({ submission, organizationId, onChanged }: { submission: MarketplaceSubmissionResponse; organizationId: string; onChanged: () => void }): React.JSX.Element {
  const withdraw = useMutation({ mutationFn: () => withdrawListing(organizationId, submission.id), onSuccess: onChanged });
  const active = submission.status === "IN_REVIEW" || submission.status === "APPROVED";
  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{submission.name}</p>
          <p className="text-xs text-muted-foreground">
            {MARKETPLACE_KIND_LABELS[submission.kind]} · v{submission.version}
            {submission.status === "APPROVED" ? ` · ${submission.installs} ${submission.installs === 1 ? "instalación" : "instalaciones"}` : ""}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[submission.status]}`}>{MARKETPLACE_STATUS_LABELS[submission.status]}</span>
      </div>
      {submission.reviewReason && (submission.status === "REJECTED" || submission.status === "WITHDRAWN") ? (
        <p className="text-sm text-muted-foreground">Motivo: {submission.reviewReason}</p>
      ) : null}
      {active ? (
        <div>
          <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Retirarla? Se desinstala de quien la tenga." loading={withdraw.isPending} onConfirm={() => withdraw.mutate()}>
            Retirar publicación
          </ConfirmButton>
        </div>
      ) : null}
      {withdraw.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorText(withdraw.error, "No pudimos retirarla. Intenta de nuevo.")}
        </p>
      ) : null}
    </li>
  );
}

function SubmitForm({ organizationId, onSubmitted }: { organizationId: string; onSubmitted: () => void }): React.JSX.Element {
  const [kind, setKind] = useState<MarketplaceKind>("INTEGRATION");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [partnerUrl, setPartnerUrl] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [events, setEvents] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [siteId, setSiteId] = useState("");
  const [pageId, setPageId] = useState("");
  const [themeCode, setThemeCode] = useState("claro-profesional");
  const [invalid, setInvalid] = useState<string | null>(null);

  const sites = useSites(organizationId);
  const pages = usePages(organizationId, siteId);
  const themes = useThemes(organizationId);
  const catalogThemes = (themes.data ?? []).filter((theme) => theme.code !== null);

  const submit = useMutation({
    mutationFn: async () => {
      const common = { name: name.trim(), summary: summary.trim(), description: description.trim(), partnerName: partnerName.trim(), version: version.trim(), ...(partnerUrl.trim() ? { partnerUrl: partnerUrl.trim() } : {}) };
      if (kind === "INTEGRATION") {
        const body: SubmitIntegration = { kind, ...common, integration: { events, ...(instructions.trim() ? { instructions: instructions.trim() } : {}) } };
        return submitListing(organizationId, body);
      }
      // La plantilla se arma con los bloques visibles de una página propia; el servidor la valida contra el catálogo.
      const blocks = (await listBlocks(organizationId, siteId, pageId)).filter((block) => block.visible);
      const body: SubmitTemplate = {
        kind,
        ...common,
        template: {
          themeCode,
          industryTags: ["emprendimiento"],
          objectiveTags: ["mostrar"],
          blocksSeed: blocks.map((block) => ({ type: block.type, configSchemaVersion: block.configSchemaVersion, config: block.config, ...(block.isPrimary ? { isPrimary: true as const } : {}) })),
        },
      };
      return submitListing(organizationId, body);
    },
    onSuccess: () => {
      setName("");
      setSummary("");
      setDescription("");
      setEvents([]);
      setInstructions("");
      onSubmitted();
    },
  });

  function validate(event: React.FormEvent): void {
    event.preventDefault();
    if (name.trim().length < 3) return setInvalid("Ponle un nombre de al menos 3 caracteres.");
    if (summary.trim().length < 10) return setInvalid("El resumen necesita al menos 10 caracteres.");
    if (description.trim().length < 20) return setInvalid("La descripción necesita al menos 20 caracteres.");
    if (partnerName.trim().length < 2) return setInvalid("Escribe el nombre con que apareces como socio.");
    if (kind === "INTEGRATION" && events.length === 0) return setInvalid("Elige al menos un evento que recibirá la integración.");
    if (kind === "TEMPLATE" && (!siteId || !pageId)) return setInvalid("Elige la página de la que saldrá la plantilla.");
    setInvalid(null);
    submit.mutate();
  }

  return (
    <form noValidate onSubmit={validate} aria-label="Publicar en el marketplace" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <h3 className="text-base font-semibold text-foreground">Publicar algo nuevo</h3>
      <label className="flex flex-col gap-1 text-sm text-foreground">
        Qué publicas
        <select value={kind} onChange={(event) => setKind(event.target.value as MarketplaceKind)} className={selectClass}>
          <option value="INTEGRATION">Una integración (envía eventos a otra herramienta)</option>
          <option value="TEMPLATE">Una plantilla (a partir de una de tus páginas)</option>
        </select>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Nombre" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required />
        <Input label="Versión" value={version} placeholder="1.0.0" onChange={(event) => setVersion(event.target.value)} />
        <Input label="Tu nombre como socio" value={partnerName} maxLength={80} onChange={(event) => setPartnerName(event.target.value)} required />
        <Input label="Sitio web del socio (opcional)" value={partnerUrl} placeholder="https://" onChange={(event) => setPartnerUrl(event.target.value)} />
      </div>
      <Input label="Resumen (una línea)" value={summary} maxLength={160} onChange={(event) => setSummary(event.target.value)} required />
      <label className="flex flex-col gap-1 text-sm text-foreground">
        Descripción
        <textarea value={description} rows={3} maxLength={1000} onChange={(event) => setDescription(event.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" />
      </label>

      {kind === "INTEGRATION" ? (
        <>
          <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium text-foreground">Eventos que recibe</legend>
            {WEBHOOK_EVENT_TYPES.map((event) => (
              <label key={event} className="flex items-start gap-2 text-sm text-foreground">
                <input type="checkbox" className="mt-1" checked={events.includes(event)} onChange={(change) => setEvents((current) => (change.target.checked ? [...current, event] : current.filter((item) => item !== event)))} />
                <span>
                  {WEBHOOK_EVENT_LABELS[event].label}
                  <span className="block text-xs text-muted-foreground">{WEBHOOK_EVENT_LABELS[event].description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Input label="Cómo conectarla (opcional)" value={instructions} maxLength={500} onChange={(event) => setInstructions(event.target.value)} />
        </>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Sitio
            <select value={siteId} onChange={(event) => { setSiteId(event.target.value); setPageId(""); }} className={selectClass}>
              <option value="">Elegir…</option>
              {(sites.data ?? []).map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Página
            <select value={pageId} onChange={(event) => setPageId(event.target.value)} className={selectClass} disabled={!siteId}>
              <option value="">Elegir…</option>
              {(pages.data ?? []).filter((page) => page.deletedAt === null).map((page) => (
                <option key={page.id} value={page.id}>
                  {page.isHome ? "Inicio" : page.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Tema
            <select value={themeCode} onChange={(event) => setThemeCode(event.target.value)} className={selectClass}>
              {catalogThemes.map((theme) => (
                <option key={theme.code} value={theme.code ?? ""}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {invalid ? (
        <p role="alert" className="text-sm text-danger">
          {invalid}
        </p>
      ) : null}
      {submit.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorText(submit.error, "No pudimos enviar la publicación. Revisa los datos e intenta de nuevo.")}
        </p>
      ) : null}
      {submit.isSuccess ? (
        <p role="status" className="text-sm text-primary">
          Enviada a revisión. Te mostramos su estado arriba.
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={submit.isPending}>
          Enviar a revisión
        </Button>
      </div>
    </form>
  );
}
