"use client";

import type { PageCampaignResponse, PageResponse } from "@impulza/contracts";
import { Button, Dialog, Input, Select } from "@impulza/ui";
import {
  TEMPLATE_OBJECTIVE_LABELS,
  TEMPLATE_OBJECTIVES,
  createPageCampaignSchema,
  suggestUtmCampaign,
  updatePageCampaignSchema,
  type TemplateObjective,
  type UpdatePageCampaignInput,
} from "@impulza/validation";
import { useState, type FormEvent } from "react";
import { useSavePageCampaign } from "../../lib/hooks/use-page-campaigns";
import { isoToLocalInput, localInputToIso, pageCampaignErrorMessage } from "../../lib/page-campaign-messages";

interface Draft {
  name: string;
  objective: TemplateObjective;
  pageId: string;
  startsAt: string;
  endsAt: string;
  replaceHome: boolean;
  utmCampaign: string;
}

type FieldErrors = Partial<Record<keyof Draft, string>>;

const HOUR_MS = 60 * 60 * 1000;

/** Valores iniciales: los de la campaña al editar; al crear, desde la próxima hora en punto por 7 días. */
function initialDraft(campaign: PageCampaignResponse | null, pages: PageResponse[]): Draft {
  if (campaign) {
    return {
      name: campaign.name,
      objective: campaign.objective,
      pageId: campaign.pageId,
      startsAt: isoToLocalInput(campaign.startsAt),
      endsAt: isoToLocalInput(campaign.endsAt),
      replaceHome: campaign.replaceHome,
      utmCampaign: campaign.utmCampaign,
    };
  }
  const start = new Date(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS);
  return {
    name: "",
    objective: "vender",
    pageId: pages[0]?.id ?? "",
    startsAt: isoToLocalInput(start.toISOString()),
    endsAt: isoToLocalInput(new Date(start.getTime() + 7 * 24 * HOUR_MS).toISOString()),
    replaceHome: false,
    utmCampaign: "",
  };
}

/**
 * Crear o editar una campaña (F7.7, ADR-022). Se valida con el mismo esquema que la API, pero la API
 * es la autoridad: comprueba la página, los solapes y el límite, y su mensaje se muestra tal cual.
 * Al editar solo se envía lo que cambió (una fecha sin tocar conserva sus segundos originales).
 */
export function CampaignEditorDialog({
  open,
  onOpenChange,
  organizationId,
  siteId,
  campaign,
  pages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  siteId: string;
  /** `null` para crear una nueva. */
  campaign: PageCampaignResponse | null;
  /** Páginas elegibles: publicadas, no de inicio, fuera de la papelera. */
  pages: PageResponse[];
}): React.JSX.Element {
  const save = useSavePageCampaign(organizationId, siteId);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(campaign, pages));
  const [utmTouched, setUtmTouched] = useState(campaign !== null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const formId = campaign ? `campana-${campaign.id}` : "campana-nueva";
  const initial = initialDraft(campaign, pages);

  function close(next: boolean): void {
    onOpenChange(next);
    if (!next) {
      save.reset();
      setErrors({});
      setFormError(null);
    }
  }

  function update(patch: Partial<Draft>): void {
    setDraft((current) => {
      const next = { ...current, ...patch };
      // La UTM sigue al nombre mientras el usuario no la haya escrito a mano.
      if (patch.name !== undefined && !utmTouched) {
        next.utmCampaign = suggestUtmCampaign(patch.name);
      }
      return next;
    });
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    const startsAt = localInputToIso(draft.startsAt);
    const endsAt = localInputToIso(draft.endsAt);
    const missing: FieldErrors = {};
    if (!startsAt) missing.startsAt = "Elige la fecha y hora de inicio.";
    if (!endsAt) missing.endsAt = "Elige la fecha y hora de fin.";
    if (!draft.pageId) missing.pageId = "Elige la página de la campaña.";
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }

    const full = { ...draft, startsAt: startsAt as string, endsAt: endsAt as string };
    let input: UpdatePageCampaignInput;
    if (campaign === null) {
      const parsed = createPageCampaignSchema.safeParse(full);
      if (!parsed.success) {
        setErrors(issuesToErrors(parsed.error.issues));
        return;
      }
      input = parsed.data;
    } else {
      const changed: Record<string, unknown> = {};
      for (const key of Object.keys(draft) as (keyof Draft)[]) {
        if (draft[key] !== initial[key]) {
          changed[key] = full[key];
        }
      }
      // Si cambia solo una punta, la otra va igual para validar la ventana completa en el cliente.
      if (changed.startsAt !== undefined || changed.endsAt !== undefined) {
        changed.startsAt ??= campaign.startsAt;
        changed.endsAt ??= campaign.endsAt;
      }
      if (Object.keys(changed).length === 0) {
        close(false);
        return;
      }
      const parsed = updatePageCampaignSchema.safeParse(changed);
      if (!parsed.success) {
        setErrors(issuesToErrors(parsed.error.issues));
        return;
      }
      input = parsed.data;
    }

    save.mutate({ campaignId: campaign?.id ?? null, input }, { onSuccess: () => close(false) });
  }

  function issuesToErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
    const next: FieldErrors = {};
    for (const issue of issues) {
      const field = issue.path[0];
      if (typeof field === "string" && field in draft) {
        next[field as keyof Draft] ??= issue.message;
      } else {
        setFormError(issue.message);
      }
    }
    return next;
  }

  const serverError = save.isError ? pageCampaignErrorMessage(save.error) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title={campaign ? `Editar «${campaign.name}»` : "Nueva campaña"}
      description="Una página que aparece sola en tu sitio entre dos fechas, con su propio enlace medido."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={save.isPending}>
            {campaign ? "Guardar cambios" : "Programar campaña"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Nombre"
            required
            maxLength={80}
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="Cyber Day 2026"
            helperText="Solo lo ves tú."
            error={errors.name}
          />
          <Select
            label="Objetivo"
            required
            options={TEMPLATE_OBJECTIVES.map((objective) => ({ value: objective, label: TEMPLATE_OBJECTIVE_LABELS[objective] }))}
            value={draft.objective}
            onChange={(event) => update({ objective: event.target.value as TemplateObjective })}
            error={errors.objective}
          />
        </div>

        <Select
          label="Página de la campaña"
          required
          placeholder="Elige una página publicada"
          options={[
            ...pages.map((page) => ({ value: page.id, label: `/${page.slug}` })),
            // La página actual pudo dejar de ser elegible (despublicada o en la papelera): se muestra
            // igual para no cambiarla en silencio; la API rechaza guardarla si se elige de nuevo.
            ...(campaign && !pages.some((page) => page.id === campaign.pageId)
              ? [{ value: campaign.pageId, label: campaign.pageSlug ? `/${campaign.pageSlug} (no publicada)` : "Página en la papelera" }]
              : []),
          ]}
          value={draft.pageId}
          onChange={(event) => update({ pageId: event.target.value })}
          helperText="Fuera de las fechas, la página no se ve ni aparece en el menú."
          error={errors.pageId}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Empieza"
            type="datetime-local"
            required
            value={draft.startsAt}
            onChange={(event) => update({ startsAt: event.target.value })}
            error={errors.startsAt}
          />
          <Input
            label="Termina"
            type="datetime-local"
            required
            value={draft.endsAt}
            onChange={(event) => update({ endsAt: event.target.value })}
            helperText="Hora de tu dispositivo. La página se cambia en menos de un minuto."
            error={errors.endsAt}
          />
        </div>

        <div className="flex items-start gap-3 rounded-md border border-border p-3">
          <input
            id={`${formId}-inicio`}
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--color-primary)]"
            aria-describedby={`${formId}-inicio-ayuda`}
            checked={draft.replaceHome}
            onChange={(event) => update({ replaceHome: event.target.checked })}
          />
          <div className="flex flex-col gap-0.5">
            <label htmlFor={`${formId}-inicio`} className="text-sm font-medium text-foreground">
              Mostrarla como inicio mientras dure
            </label>
            <p id={`${formId}-inicio-ayuda`} className="text-sm text-muted-foreground">
              Quien entre a tu sitio verá esta página en lugar de tu inicio. Al terminar, tu inicio vuelve solo, sin tocar nada.
            </p>
          </div>
        </div>

        <Input
          label="Nombre en Analytics (utm_campaign)"
          required
          maxLength={60}
          value={draft.utmCampaign}
          onChange={(event) => {
            setUtmTouched(true);
            update({ utmCampaign: event.target.value });
          }}
          helperText="Minúsculas, números y guiones. Se arma solo con el nombre."
          error={errors.utmCampaign}
        />

        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}
        {serverError ? (
          <p role="alert" className="text-sm text-danger">
            {serverError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
