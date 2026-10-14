"use client";

import type { TemplateResponse } from "@impulza/contracts";
import { publicSlugSchema } from "@impulza/validation";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { Check, CircleAlert, Copy, FilePlus2, Globe, LayoutTemplate, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { ChoiceCards, type Choice } from "../../../../components/onboarding/choice-cards";
import { PlanLimitNotice } from "../../../../components/plan-limit-notice";
import { TemplateGallery } from "../../../../components/templates/template-gallery";
import { DevicePreview } from "../../../../components/templates/template-preview-dialog";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { ApiError } from "../../../../lib/api-client";
import { listPages } from "../../../../lib/api/pages";
import { env } from "../../../../lib/env";
import { useApplyTemplate } from "../../../../lib/hooks/use-apply-template";
import { useCreateSite, useDuplicateSite, useSites } from "../../../../lib/hooks/use-sites";
import { getPlanLimitInfo } from "../../../../lib/plan-limit";
import { slugify } from "../../../../lib/slugify";
import { useSlugAvailability } from "../../../../lib/use-slug-availability";

type Mode = "blank" | "template" | "duplicate";

const MODE_CHOICES: readonly Choice<Mode>[] = [
  { value: "blank", icon: FilePlus2, label: "Sitio en blanco", description: "Empiezas desde cero y lo armas en el constructor." },
  { value: "template", icon: LayoutTemplate, label: "Desde una plantilla", description: "Elige un diseño listo, míralo en móvil y escritorio, y personalízalo." },
  { value: "duplicate", icon: Copy, label: "Duplicar un sitio existente", description: "Parte de uno de tus sitios: ideal para un cliente nuevo parecido a otro." },
];

const nameSchema = z.string().trim().min(2, "Mínimo 2 caracteres.").max(120, "Máximo 120 caracteres.");

export default function NuevoSitioPage(): React.JSX.Element {
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para crear un sitio." />;
  }

  return <CreateSiteForm organizationId={activeOrganizationId} />;
}

function CreateSiteForm({ organizationId }: { organizationId: string }): React.JSX.Element {
  const router = useRouter();
  const createMutation = useCreateSite(organizationId);
  const duplicateMutation = useDuplicateSite(organizationId);
  const applyMutation = useApplyTemplate(organizationId);
  const sitesQuery = useSites(organizationId);

  const [mode, setMode] = useState<Mode>("blank");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [template, setTemplate] = useState<TemplateResponse | null>(null);
  const [sourceSiteId, setSourceSiteId] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ name?: string; slug?: string; general?: string }>({});
  const [lastError, setLastError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  // Si el sitio ya se creó pero la plantilla falló, el reintento solo vuelve a aplicarla: no crea otro sitio.
  const [created, setCreated] = useState<{ siteId: string; pageId: string } | null>(null);

  const availability = useSlugAvailability(slug);
  const base = env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/+$/, "");
  const host = base.replace(/^https?:\/\//, "");
  const sources = (sitesQuery.data ?? []).filter((site) => site.status !== "ARCHIVED");

  function onNameChange(value: string): void {
    setName(value);
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  }

  function validate(): { name: string; slug: string } | null {
    const nextErrors: typeof errors = {};
    const parsedName = nameSchema.safeParse(name);
    const parsedSlug = publicSlugSchema.safeParse(slug);
    if (!parsedName.success) {
      nextErrors.name = parsedName.error.issues[0]?.message;
    }
    if (!parsedSlug.success) {
      nextErrors.slug = parsedSlug.error.issues[0]?.message ?? "Dirección no válida.";
    }
    if (mode === "template" && !template) {
      nextErrors.general = "Elige una plantilla para continuar.";
    }
    if (mode === "duplicate" && !sourceSiteId) {
      nextErrors.general = "Elige el sitio que quieres duplicar.";
    }
    setErrors(nextErrors);
    return parsedName.success && parsedSlug.success && !nextErrors.general ? { name: parsedName.data, slug: parsedSlug.data } : null;
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setLastError(null);
    const values = validate();
    if (!values) {
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "duplicate" && sourceSiteId) {
        const copy = await duplicateMutation.mutateAsync({ siteId: sourceSiteId, ...values });
        router.push(`/sitios/${copy.id}`);
        return;
      }

      let target = created;
      if (!target) {
        const site = await createMutation.mutateAsync(values);
        const pages = await listPages(organizationId, site.id);
        const home = pages.find((page) => page.isHome);
        target = { siteId: site.id, pageId: home?.id ?? "" };
        setCreated(target);
        if (mode === "blank" || !home) {
          router.push(`/sitios/${site.id}`);
          return;
        }
      }

      if (mode === "template" && template && target.pageId) {
        await applyMutation.mutateAsync({
          siteId: target.siteId,
          pageId: target.pageId,
          input: { templateCode: template.code, applyAppearance: true, personalization: { name: values.name } },
        });
      }
      router.push(`/sitios/${target.siteId}`);
    } catch (error) {
      setLastError(error);
      if (getPlanLimitInfo(error)) {
        return;
      }
      if (error instanceof ApiError && error.status === 409 && !created) {
        setErrors({ slug: "Esa dirección ya está tomada. Elige otra." });
      } else if (created) {
        setErrors({
          general: "Creamos el sitio, pero no pudimos aplicar la plantilla. Reintenta o aplícala después desde el constructor.",
        });
      } else {
        setErrors({ general: "Ocurrió un error inesperado. Intenta de nuevo." });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel =
    mode === "duplicate" ? "Duplicar y crear sitio" : created ? "Reintentar aplicar la plantilla" : mode === "template" ? "Crear sitio con esta plantilla" : "Crear sitio en blanco";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="relative overflow-clip rounded-3xl border border-border bg-background p-5 shadow-xl shadow-primary/5 before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:bg-gradient-to-r before:from-primary before:via-primary/60 before:to-primary/10 sm:p-8">
        <div className="mb-6 flex items-start gap-4">
          <span
            aria-hidden="true"
            className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/30"
          >
            <Plus className="size-7" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Crear sitio</h1>
            <p className="mt-1 text-sm text-muted-foreground">Elige cómo empezar. Todo se puede cambiar después en el constructor.</p>
          </div>
        </div>

        <form className="flex flex-col gap-6" onSubmit={(event) => void onSubmit(event)} noValidate>
          <ChoiceCards legend="Cómo empezar" name="site-mode" choices={MODE_CHOICES} value={mode} onChange={setMode} columns={3} />

          <section aria-labelledby="site-identity-title" className="rounded-2xl border border-border bg-surface/50 p-5">
            <h2 id="site-identity-title" className="mb-4 flex items-center gap-2 text-base font-semibold text-foreground">
              <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
              Nombre y dirección
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Nombre del sitio" value={name} onChange={(event) => onNameChange(event.target.value)} error={errors.name} autoComplete="off" />
              <Input
                label="Dirección pública"
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value.trim().toLowerCase());
                }}
                autoCapitalize="none"
                spellCheck={false}
                helperText={errors.slug ? undefined : `${host}/${slug || "tu-direccion"}`}
                error={errors.slug}
              />
            </div>
            <p role="status" aria-live="polite" className="mt-3 flex min-h-6 items-center gap-2 text-sm">
              {availability.state === "checking" ? (
                <>
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">Comprobando disponibilidad…</span>
                </>
              ) : availability.state === "taken" ? (
                <>
                  <CircleAlert className="size-4 text-danger" aria-hidden="true" />
                  <span className="font-medium text-danger">Esa dirección ya está en uso. Prueba con otra.</span>
                </>
              ) : availability.state === "free" ? (
                <>
                  <Check className="size-4 text-success" aria-hidden="true" />
                  <span className="font-medium text-foreground">Parece disponible. La confirmamos al crear.</span>
                </>
              ) : null}
            </p>
          </section>

          {mode === "template" ? (
            <section aria-labelledby="site-template-title" className="flex flex-col gap-4">
              <h2 id="site-template-title" className="text-lg font-semibold text-foreground">
                Elige una plantilla
              </h2>
              <TemplateGallery selectedCode={template?.code ?? null} useLabel="Elegir esta plantilla" onUse={setTemplate} />
              {template ? (
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4" aria-live="polite">
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Check className="size-4 text-primary" aria-hidden="true" />
                    Elegida: {template.name}
                  </p>
                  <DevicePreview template={template} personalization={name.trim().length >= 2 ? { name: name.trim() } : undefined} />
                </div>
              ) : null}
            </section>
          ) : null}

          {mode === "duplicate" ? (
            <section aria-labelledby="site-duplicate-title" className="flex flex-col gap-4">
              <h2 id="site-duplicate-title" className="text-lg font-semibold text-foreground">
                ¿Qué sitio quieres duplicar?
              </h2>
              {sitesQuery.isPending ? (
                <LoadingState label="Cargando tus sitios…" />
              ) : sitesQuery.isError ? (
                <ErrorState title="No pudimos cargar tus sitios" onRetry={() => void sitesQuery.refetch()} />
              ) : sources.length === 0 ? (
                <EmptyState
                  title="Aún no tienes sitios para duplicar"
                  description="Crea el primero en blanco o desde una plantilla; después podrás usarlo como base."
                  action={
                    <Button type="button" variant="secondary" onClick={() => setMode("template")}>
                      Elegir una plantilla
                    </Button>
                  }
                />
              ) : (
                <ChoiceCards
                  legend="Sitio a duplicar"
                  name="site-source"
                  choices={sources.map((site) => ({ value: site.id, icon: Globe, label: site.name, description: `${host}/${site.slug}` }))}
                  value={sourceSiteId}
                  onChange={setSourceSiteId}
                />
              )}
              <p className="text-sm text-muted-foreground">La copia incluye sus páginas y diseño, y cuenta contra el límite de sitios de tu plan.</p>
            </section>
          ) : null}

          {errors.general ? (
            <p role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
              {errors.general}
            </p>
          ) : null}
          <PlanLimitNotice error={lastError} />

          <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button asChild variant="ghost">
              <Link href={created ? `/sitios/${created.siteId}` : "/sitios"}>{created ? "Ir al sitio creado" : "Cancelar"}</Link>
            </Button>
            <Button type="submit" loading={submitting} className="min-h-11 px-6">
              {submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
