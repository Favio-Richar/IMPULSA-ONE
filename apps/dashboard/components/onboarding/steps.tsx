"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { TemplateResponse } from "@impulza/contracts";
import {
  detectSocialNetwork,
  ONBOARDING_ACCOUNT_TYPE_LABELS,
  ONBOARDING_ACCOUNT_TYPES,
  phoneSchema,
  publicSlugSchema,
  safeUrlSchema,
  SOCIAL_NETWORK_LABELS,
  TEMPLATE_INDUSTRIES,
  TEMPLATE_INDUSTRY_LABELS,
  TEMPLATE_MAX_IMPORTED_LINKS,
  TEMPLATE_MAX_IMPORTED_SOCIALS,
  TEMPLATE_OBJECTIVE_LABELS,
  TEMPLATE_OBJECTIVES,
  type TemplateObjective,
} from "@impulza/validation";
import { Button, ErrorState, Input, LoadingState, Textarea } from "@impulza/ui";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { env } from "../../lib/env";
import { useTemplates } from "../../lib/hooks/use-templates";
import { useOnboardingStore } from "../../lib/onboarding-store";
import { slugify } from "../../lib/slugify";
import { TemplateGallery } from "../templates/template-gallery";
import { DevicePreview } from "../templates/template-preview-dialog";
import { ChoiceCards } from "./choice-cards";
import { draftToPersonalization, primaryActionType } from "./draft";

export interface StepProps {
  onNext: () => void;
  onBack: () => void;
}

/** Botones Atrás/Continuar al pie de cada paso. `form` los asocia al formulario del paso. */
export function StepActions({
  onBack,
  nextLabel = "Continuar",
  nextDisabled,
  onNext,
  form,
  loading,
  secondary,
}: {
  onBack?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
  form?: string;
  loading?: boolean;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <Button type="button" variant="ghost" onClick={onBack} disabled={loading}>
          Atrás
        </Button>
      ) : (
        <span />
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {secondary}
        <Button type={form ? "submit" : "button"} form={form} onClick={onNext} disabled={nextDisabled} loading={loading}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}

/** Acepta `instagram.com/ana` sin protocolo: lo más común al pegar desde una app. */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

// --- 1-3: tipo de cuenta, objetivo, industria --------------------------------------------------

export function AccountStep({ onNext }: StepProps) {
  const value = useOnboardingStore((state) => state.draft.accountType);
  const update = useOnboardingStore((state) => state.update);

  return (
    <>
      <ChoiceCards
        legend="Tipo de cuenta"
        name="accountType"
        columns={3}
        choices={ONBOARDING_ACCOUNT_TYPES.map((type) => ({ value: type, ...ONBOARDING_ACCOUNT_TYPE_LABELS[type] }))}
        value={value}
        onChange={(accountType) => update({ accountType })}
      />
      <StepActions onNext={onNext} nextDisabled={!value} />
    </>
  );
}

const OBJECTIVE_DESCRIPTIONS: Record<TemplateObjective, string> = {
  captar: "Que te escriban y dejen sus datos.",
  vender: "Mostrar productos y cerrar ventas.",
  reservar: "Que agenden una hora o una mesa.",
  mostrar: "Un portafolio de tu trabajo.",
  compartir: "Todos tus enlaces y redes en un lugar.",
};

export function ObjectiveStep({ onNext, onBack }: StepProps) {
  const value = useOnboardingStore((state) => state.draft.objective);
  const update = useOnboardingStore((state) => state.update);

  return (
    <>
      <ChoiceCards
        legend="Objetivo principal"
        name="objective"
        choices={TEMPLATE_OBJECTIVES.map((objective) => ({
          value: objective,
          label: TEMPLATE_OBJECTIVE_LABELS[objective],
          description: OBJECTIVE_DESCRIPTIONS[objective],
        }))}
        value={value}
        onChange={(objective) => update({ objective })}
      />
      <StepActions onBack={onBack} onNext={onNext} nextDisabled={!value} />
    </>
  );
}

export function IndustryStep({ onNext, onBack }: StepProps) {
  const value = useOnboardingStore((state) => state.draft.industry);
  const update = useOnboardingStore((state) => state.update);

  return (
    <>
      <ChoiceCards
        legend="Industria"
        name="industry"
        columns={3}
        choices={TEMPLATE_INDUSTRIES.map((industry) => ({ value: industry, label: TEMPLATE_INDUSTRY_LABELS[industry] }))}
        value={value}
        onChange={(industry) => update({ industry })}
      />
      <StepActions onBack={onBack} onNext={onNext} nextDisabled={!value} />
    </>
  );
}

// --- 4-5: nombre y dirección -------------------------------------------------------------------

const nameSchema = z.object({
  displayName: z.string().trim().min(2, "Mínimo 2 caracteres.").max(120, "Máximo 120 caracteres."),
});

export function NameStep({ onNext, onBack }: StepProps) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);
  const form = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { displayName: draft.displayName },
  });
  const label =
    draft.accountType === "negocio" ? "Nombre del negocio" : draft.accountType === "agencia" ? "Nombre de la marca que vas a publicar" : "Tu nombre o el de tu marca";

  return (
    <form
      id="onboarding-name"
      noValidate
      onSubmit={form.handleSubmit(({ displayName }) => {
        // Si la dirección todavía no se tocó, se sugiere a partir del nombre.
        update({ displayName, ...(draft.slug === "" ? { slug: slugify(displayName) } : {}) });
        onNext();
      })}
    >
      <Input
        label={label}
        helperText="Es lo primero que verán tus visitantes, arriba de tu página."
        autoComplete="organization"
        error={form.formState.errors.displayName?.message}
        {...form.register("displayName")}
      />
      <StepActions onBack={onBack} form="onboarding-name" />
    </form>
  );
}

const slugFormSchema = z.object({ slug: publicSlugSchema });

export function SlugStep({ onNext, onBack, conflictMessage }: StepProps & { conflictMessage?: string | null }) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);
  const form = useForm<z.infer<typeof slugFormSchema>>({
    resolver: zodResolver(slugFormSchema),
    defaultValues: { slug: draft.slug || slugify(draft.displayName) },
  });
  const slug = useWatch({ control: form.control, name: "slug" });
  const base = env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/+$/, "");

  return (
    <form
      id="onboarding-slug"
      noValidate
      onSubmit={form.handleSubmit((values) => {
        update({ slug: values.slug });
        onNext();
      })}
    >
      {conflictMessage ? (
        <p role="alert" className="mb-4 rounded-md border border-danger/40 bg-surface p-3 text-sm text-danger">
          {conflictMessage}
        </p>
      ) : null}
      <Input
        label="Dirección de tu página"
        helperText={form.formState.errors.slug ? undefined : "Minúsculas, números y guiones. Si ya está en uso, te avisamos al publicar."}
        autoCapitalize="none"
        spellCheck={false}
        error={form.formState.errors.slug?.message}
        {...form.register("slug", { setValueAs: (value: string) => value.trim().toLowerCase() })}
      />
      <p className="mt-3 break-all text-sm text-muted-foreground">
        Tu página quedará en <span className="font-medium text-foreground">{base}/{slug || "tu-direccion"}</span>
      </p>
      <StepActions onBack={onBack} form="onboarding-slug" />
    </form>
  );
}

// --- 6: redes y enlaces ------------------------------------------------------------------------

function isValidUrl(value: string): boolean {
  return safeUrlSchema.safeParse(value).success;
}

/**
 * "Importación de redes y enlaces" (PM §8.2 punto 6): se pegan las direcciones de los perfiles y
 * enlaces que ya se tienen, y se reconoce la red de cada uno por su dominio. No se conecta a la
 * cuenta de ninguna red ni se leen datos de ellas: eso exigiría integraciones con cada plataforma,
 * que el plan maestro ubica en Integraciones (§9.15), fuera de este paso.
 */
export function ImportStep({ onNext, onBack }: StepProps) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);
  const [socials, setSocials] = useState<string[]>(draft.socials.length > 0 ? draft.socials : [""]);
  const [links, setLinks] = useState<Array<{ label: string; url: string }>>(draft.links);
  const [submitted, setSubmitted] = useState(false);

  const socialErrors = socials.map((url) => (url.trim() !== "" && !isValidUrl(normalizeUrl(url)) ? "Pega la dirección completa del perfil." : null));
  const linkErrors = links.map((link) => ({
    label: link.label.trim() === "" && link.url.trim() !== "" ? "Ponle un texto al botón." : null,
    url: link.label.trim() !== "" && !isValidUrl(normalizeUrl(link.url)) ? "Pega una dirección válida (https://…)." : null,
  }));
  const hasErrors = socialErrors.some(Boolean) || linkErrors.some((error) => error.label || error.url);

  function submit(): void {
    setSubmitted(true);
    if (hasErrors) {
      return;
    }
    update({
      socials: socials.map(normalizeUrl).filter((url) => url !== ""),
      links: links
        .filter((link) => link.label.trim() !== "" && link.url.trim() !== "")
        .map((link) => ({ label: link.label.trim(), url: normalizeUrl(link.url) })),
    });
    onNext();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="onboarding-socials">
        <div>
          <h2 id="onboarding-socials" className="text-sm font-semibold text-foreground">
            Tus redes sociales
          </h2>
          <p className="text-sm text-muted-foreground">Pega la dirección de cada perfil. Reconocemos la red sola.</p>
        </div>
        {socials.map((url, index) => {
          const network = detectSocialNetwork(normalizeUrl(url));
          return (
            <div key={index} className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  label={`Red ${index + 1}`}
                  placeholder="instagram.com/tu-perfil"
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={url}
                  helperText={url.trim() !== "" && !socialErrors[index] ? (network ? SOCIAL_NETWORK_LABELS[network] : "Sitio web") : undefined}
                  error={submitted ? (socialErrors[index] ?? undefined) : undefined}
                  onChange={(event) => setSocials((current) => current.map((item, i) => (i === index ? event.target.value : item)))}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-7"
                aria-label={`Quitar red ${index + 1}`}
                onClick={() => setSocials((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          );
        })}
        {socials.length < TEMPLATE_MAX_IMPORTED_SOCIALS ? (
          <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setSocials((current) => [...current, ""])}>
            <Plus className="size-4" aria-hidden="true" />
            Agregar red
          </Button>
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="onboarding-links">
        <div>
          <h2 id="onboarding-links" className="text-sm font-semibold text-foreground">
            Otros enlaces
          </h2>
          <p className="text-sm text-muted-foreground">
            Tu tienda, tu carta, tu agenda… Cada uno será un botón de tu página (hasta {TEMPLATE_MAX_IMPORTED_LINKS}).
          </p>
        </div>
        {links.map((link, index) => (
          <div key={index} className="grid grid-cols-1 items-start gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              label="Texto del botón"
              placeholder="Ver mi tienda"
              value={link.label}
              error={submitted ? (linkErrors[index]?.label ?? undefined) : undefined}
              onChange={(event) => setLinks((current) => current.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)))}
            />
            <Input
              label="Dirección"
              placeholder="tutienda.cl"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              value={link.url}
              error={submitted ? (linkErrors[index]?.url ?? undefined) : undefined}
              onChange={(event) => setLinks((current) => current.map((item, i) => (i === index ? { ...item, url: event.target.value } : item)))}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="sm:mt-7"
              aria-label={`Quitar enlace ${index + 1}`}
              onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        {links.length < TEMPLATE_MAX_IMPORTED_LINKS ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => setLinks((current) => [...current, { label: "", url: "" }])}
          >
            <Plus className="size-4" aria-hidden="true" />
            Agregar enlace
          </Button>
        ) : null}
      </section>

      {submitted && hasErrors ? (
        <p role="alert" className="text-sm text-danger">
          Revisa las direcciones marcadas.
        </p>
      ) : null}
      <StepActions onBack={onBack} onNext={submit} nextLabel={socials.some((url) => url.trim()) || links.length > 0 ? "Continuar" : "Omitir por ahora"} />
    </div>
  );
}

// --- 7: plantilla ------------------------------------------------------------------------------

export function TemplateStep({ onNext, onBack }: StepProps) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        Te mostramos primero las pensadas para {draft.industry ? TEMPLATE_INDUSTRY_LABELS[draft.industry].toLowerCase() : "tu rubro"}
        {draft.objective ? ` y para ${TEMPLATE_OBJECTIVE_LABELS[draft.objective].toLowerCase()}` : ""}. Cambia los filtros para
        ver otras.
      </p>
      <TemplateGallery
        initialFilters={{ industry: draft.industry ?? undefined, objective: draft.objective ?? undefined }}
        selectedCode={draft.templateCode}
        onUse={(template) => {
          update({ templateCode: template.code });
          onNext();
        }}
      />
      <StepActions onBack={onBack} onNext={onNext} nextDisabled={!draft.templateCode} nextLabel="Continuar con la elegida" />
    </>
  );
}

/** La plantilla elegida, del catálogo ya cargado (misma caché que la galería). */
export function useChosenTemplate(): { template: TemplateResponse | null; isPending: boolean; isError: boolean; retry: () => void } {
  const templateCode = useOnboardingStore((state) => state.draft.templateCode);
  const query = useTemplates({});
  return {
    template: query.data?.find((template) => template.code === templateCode) ?? null,
    isPending: query.isPending,
    isError: query.isError,
    retry: () => void query.refetch(),
  };
}

// --- 8: perfil y acción principal --------------------------------------------------------------

const profileFormSchema = z.object({
  headline: z.string().trim().max(160, "Máximo 160 caracteres."),
  bio: z.string().trim().max(500, "Máximo 500 caracteres."),
  whatsappPhone: z.string().trim(),
  primaryLinkLabel: z.string().trim().max(80, "Máximo 80 caracteres."),
  primaryLinkUrl: z.string().trim(),
});

export function ProfileStep({ onNext, onBack }: StepProps) {
  const draft = useOnboardingStore((state) => state.draft);
  const update = useOnboardingStore((state) => state.update);
  const { template, isPending, isError, retry } = useChosenTemplate();
  const primaryType = template ? primaryActionType(template) : null;

  const schema = profileFormSchema.superRefine((values, ctx) => {
    if (primaryType === "whatsapp" && !phoneSchema.safeParse(values.whatsappPhone).success) {
      ctx.addIssue({ code: "custom", path: ["whatsappPhone"], message: "Usa formato internacional, por ejemplo +56912345678." });
    }
    if (primaryType === "link") {
      if (values.primaryLinkLabel === "") {
        ctx.addIssue({ code: "custom", path: ["primaryLinkLabel"], message: "Escribe el texto del botón." });
      }
      if (!safeUrlSchema.safeParse(normalizeUrl(values.primaryLinkUrl)).success) {
        ctx.addIssue({ code: "custom", path: ["primaryLinkUrl"], message: "Pega una dirección válida (https://…)." });
      }
    }
  });

  const form = useForm<z.infer<typeof profileFormSchema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      headline: draft.headline,
      bio: draft.bio,
      whatsappPhone: draft.whatsappPhone,
      primaryLinkLabel: draft.primaryLinkLabel,
      primaryLinkUrl: draft.primaryLinkUrl,
    },
  });

  if (isPending) {
    return <LoadingState label="Cargando tu plantilla…" />;
  }
  if (isError) {
    return <ErrorState title="No pudimos cargar tu plantilla" onRetry={retry} />;
  }
  if (!template) {
    return (
      <>
        <p role="alert" className="text-sm text-danger">
          Esa plantilla ya no está disponible. Elige otra.
        </p>
        <StepActions onBack={onBack} />
      </>
    );
  }

  return (
    <form
      id="onboarding-profile"
      noValidate
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit((values) => {
        update({ ...values, primaryLinkUrl: values.primaryLinkUrl ? normalizeUrl(values.primaryLinkUrl) : "" });
        onNext();
      })}
    >
      <Input
        label="Frase corta"
        placeholder="Qué haces, en una línea"
        helperText="Aparece bajo tu nombre. Opcional."
        error={form.formState.errors.headline?.message}
        {...form.register("headline")}
      />
      <Textarea
        label="Sobre ti"
        placeholder="Cuenta a quién ayudas y por qué elegirte."
        helperText="Opcional. Puedes darle formato después en el constructor."
        rows={4}
        error={form.formState.errors.bio?.message}
        {...form.register("bio")}
      />
      <div className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Tu acción principal</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Es el botón destacado de tu página y, en el teléfono, queda fijo abajo.
        </p>
        {primaryType === "whatsapp" ? (
          <Input
            label="Tu número de WhatsApp"
            placeholder="+56912345678"
            inputMode="tel"
            autoComplete="tel"
            required
            helperText={form.formState.errors.whatsappPhone ? undefined : "Con código de país. Tus clientes te escribirán directo."}
            error={form.formState.errors.whatsappPhone?.message}
            {...form.register("whatsappPhone")}
          />
        ) : primaryType === "link" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Texto del botón"
              placeholder="Escucha mi nuevo tema"
              required
              error={form.formState.errors.primaryLinkLabel?.message}
              {...form.register("primaryLinkLabel")}
            />
            <Input
              label="Dirección del botón"
              placeholder="https://…"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              required
              error={form.formState.errors.primaryLinkUrl?.message}
              {...form.register("primaryLinkUrl")}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Esta plantilla no tiene acción principal. Puedes elegir una en el constructor.</p>
        )}
      </div>
      <StepActions onBack={onBack} form="onboarding-profile" />
    </form>
  );
}

// --- 9: vista previa ---------------------------------------------------------------------------

export function PreviewStep({ onNext, onBack, onEdit }: StepProps & { onEdit: (stepIndex: number) => void }) {
  const draft = useOnboardingStore((state) => state.draft);
  const { template, isPending, isError, retry } = useChosenTemplate();

  if (isPending) {
    return <LoadingState label="Preparando tu vista previa…" />;
  }
  if (isError || !template) {
    return <ErrorState title="No pudimos armar la vista previa" onRetry={retry} />;
  }

  const summary: Array<{ label: string; value: string; step: number }> = [
    { label: "Nombre", value: draft.displayName, step: 3 },
    { label: "Dirección", value: `${env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/+$/, "")}/${draft.slug}`, step: 4 },
    { label: "Plantilla", value: template.name, step: 6 },
  ];

  return (
    <>
      <dl className="mb-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        {summary.map((item) => (
          <div key={item.label} className="flex items-start justify-between gap-2 rounded-md border border-border p-3">
            <div className="min-w-0">
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="break-all font-medium text-foreground">{item.value}</dd>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(item.step)} aria-label={`Cambiar ${item.label.toLowerCase()}`}>
              Cambiar
            </Button>
          </div>
        ))}
      </dl>
      <DevicePreview template={template} personalization={draftToPersonalization(draft, template)} />
      <StepActions onBack={onBack} onNext={onNext} nextLabel="Se ve bien, continuar" />
    </>
  );
}
