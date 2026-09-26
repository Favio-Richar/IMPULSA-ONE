"use client";

import { Button, ErrorState, LoadingState } from "@impulza/ui";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, Circle, ExternalLink, Globe, Loader2, MessageSquare, QrCode } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { createOrganization, listMyOrganizations } from "../../lib/api/organizations";
import { listPages, publishPage } from "../../lib/api/pages";
import { createSite } from "../../lib/api/sites";
import { applyTemplate } from "../../lib/api/templates";
import { useActiveOrgStore } from "../../lib/active-org-store";
import { env } from "../../lib/env";
import { useOnboardingStore } from "../../lib/onboarding-store";
import { PlanLimitNotice } from "../plan-limit-notice";
import { getPlanLimitInfo } from "../../lib/plan-limit";
import { draftToPersonalization } from "./draft";
import { StepActions, useChosenTemplate, type StepProps } from "./steps";

type TaskKey = "organization" | "site" | "template" | "publish";
type TaskStatus = "pending" | "running" | "done" | "error";

const TASK_LABELS: Record<TaskKey, string> = {
  organization: "Tu cuenta de Impulza",
  site: "Tu sitio y su dirección",
  template: "Tu plantilla con tus datos",
  publish: "Publicar tu página",
};

function publicUrl(slug: string): string {
  return `${env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/+$/, "")}/${slug}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * Paso 10 — Publicación. Crea, en orden, la organización (solo si el usuario no tiene ninguna),
 * el sitio con su página de inicio, aplica la plantilla con la personalización y publica. Cada
 * resultado se guarda en el borrador: si algo falla, "Reintentar" sigue desde ahí en vez de
 * duplicar lo que ya existe. Todo pasa por los endpoints de siempre, con sus validaciones, permisos
 * y límites de plan en el servidor.
 */
export function PublishStep({ onNext, onBack, onSlugConflict }: StepProps & { onSlugConflict: (message: string) => void }) {
  const draft = useOnboardingStore((state) => state.draft);
  const progress = useOnboardingStore((state) => state.progress);
  const setProgress = useOnboardingStore((state) => state.setProgress);
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  const setActiveOrganizationId = useActiveOrgStore((state) => state.setActiveOrganizationId);
  const queryClient = useQueryClient();
  const { template, isPending, isError, retry } = useChosenTemplate();
  const [statuses, setStatuses] = useState<Partial<Record<TaskKey, TaskStatus>>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (isPending) {
    return <LoadingState label="Cargando tu plantilla…" />;
  }
  if (isError || !template) {
    return <ErrorState title="No pudimos cargar tu plantilla" onRetry={retry} />;
  }
  const chosen = template;

  const tasks: TaskKey[] = ["organization", "site", "template", "publish"];

  function statusOf(task: TaskKey): TaskStatus {
    const done =
      (task === "organization" && progress.organizationId !== null) ||
      (task === "site" && progress.siteId !== null) ||
      (task === "template" && progress.templateApplied) ||
      (task === "publish" && progress.published);
    return done ? "done" : (statuses[task] ?? "pending");
  }

  async function step<T>(task: TaskKey, run: () => Promise<T>): Promise<T> {
    setStatuses((current) => ({ ...current, [task]: "running" }));
    try {
      const result = await run();
      setStatuses((current) => ({ ...current, [task]: "done" }));
      return result;
    } catch (caught) {
      setStatuses((current) => ({ ...current, [task]: "error" }));
      throw caught;
    }
  }

  async function run(publish: boolean): Promise<void> {
    setRunning(true);
    setError(null);
    // Estado actual del borrador (no el del render): un reintento continúa donde quedó.
    let current = useOnboardingStore.getState().progress;

    try {
      let ensuredOrganizationId = current.organizationId;
      if (!ensuredOrganizationId) {
        ensuredOrganizationId = await step("organization", async () => {
          // Quien ya tiene organización crea el sitio en la activa; solo una cuenta nueva crea una.
          const organizations = await listMyOrganizations();
          const existing = organizations.find((organization) => organization.id === activeOrganizationId) ?? organizations[0];
          if (existing) {
            return existing.id;
          }
          try {
            return (await createOrganization(draft.displayName, draft.slug)).id;
          } catch (caught) {
            // El identificador de la organización es interno: si está tomado, se usa una variante.
            if (caught instanceof ApiError && caught.status === 409) {
              return (await createOrganization(draft.displayName, `${draft.slug.slice(0, 58)}-${randomSuffix()}`)).id;
            }
            throw caught;
          }
        });
        setProgress({ organizationId: ensuredOrganizationId });
        void queryClient.invalidateQueries({ queryKey: ["organizations"] });
      }
      const organizationId: string = ensuredOrganizationId;
      setActiveOrganizationId(organizationId);

      current = useOnboardingStore.getState().progress;
      let ensuredSiteId = current.siteId;
      let ensuredPageId = current.pageId;
      if (!ensuredSiteId || !ensuredPageId) {
        const existingSiteId = ensuredSiteId;
        const existingSlug = current.siteSlug ?? draft.slug;
        const created = await step("site", async () => {
          const site = existingSiteId
            ? { id: existingSiteId, slug: existingSlug }
            : await createSite(organizationId, draft.displayName, draft.slug);
          const pages = await listPages(organizationId, site.id);
          const home = pages.find((page) => page.isHome);
          if (!home) {
            throw new Error("El sitio no tiene página de inicio.");
          }
          return { siteId: site.id, siteSlug: site.slug, pageId: home.id };
        });
        ensuredSiteId = created.siteId;
        ensuredPageId = created.pageId;
        setProgress(created);
        void queryClient.invalidateQueries({ queryKey: ["sites", organizationId] });
      }
      const siteId: string = ensuredSiteId;
      const pageId: string = ensuredPageId;

      if (!useOnboardingStore.getState().progress.templateApplied) {
        await step("template", () =>
          applyTemplate(organizationId, siteId, pageId, {
            templateCode: chosen.code,
            applyAppearance: true,
            personalization: draftToPersonalization(draft, chosen),
            ...(draft.accountType && draft.objective && draft.industry
              ? { onboarding: { accountType: draft.accountType, objective: draft.objective, industry: draft.industry } }
              : {}),
          }),
        );
        setProgress({ templateApplied: true });
      }

      if (publish && !useOnboardingStore.getState().progress.published) {
        await step("publish", () => publishPage(organizationId, siteId, pageId));
        setProgress({ published: true });
      }

      onNext();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && !useOnboardingStore.getState().progress.siteId) {
        // La dirección ya la usa otro sitio: se vuelve a elegirla, sin perder nada de lo demás.
        onSlugConflict(`La dirección "${draft.slug}" ya está en uso. Elige otra.`);
        return;
      }
      setError(caught);
    } finally {
      setRunning(false);
    }
  }

  const planLimited = getPlanLimitInfo(error) !== null;

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        Vamos a crear tu página en <span className="break-all font-medium text-foreground">{publicUrl(draft.slug)}</span> con la
        plantilla «{chosen.name}». Todo queda editable en el constructor.
      </p>
      <ol className="flex flex-col gap-2" aria-label="Progreso de la publicación">
        {tasks.map((task) => {
          const status = statusOf(task);
          return (
            <li key={task} className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
              {status === "done" ? (
                <Check className="size-4 text-success" aria-hidden="true" />
              ) : status === "running" ? (
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
              ) : status === "error" ? (
                <Circle className="size-4 text-danger" aria-hidden="true" />
              ) : (
                <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="text-foreground">{TASK_LABELS[task]}</span>
              <span className="ml-auto text-muted-foreground">
                {status === "done" ? "Listo" : status === "running" ? "En curso…" : status === "error" ? "No se pudo" : "Pendiente"}
              </span>
            </li>
          );
        })}
      </ol>
      <div aria-live="polite" className="mt-4">
        {planLimited ? <PlanLimitNotice error={error} /> : null}
        {error && !planLimited ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-surface p-3 text-sm text-danger">
            Algo falló a mitad de camino. Lo que ya quedó listo se conserva: reintenta para seguir desde ahí.
          </p>
        ) : null}
      </div>
      <StepActions
        onBack={running ? undefined : onBack}
        onNext={() => void run(true)}
        loading={running}
        nextDisabled={planLimited}
        nextLabel={error ? "Reintentar y publicar" : "Publicar mi página"}
        secondary={
          <Button type="button" variant="secondary" disabled={running || planLimited} onClick={() => void run(false)}>
            Guardar sin publicar
          </Button>
        }
      />
    </>
  );
}

/** Paso 11 — checklist de QR, dominio, analítica y primer contacto (PM §8.2 punto 11). */
export function ChecklistStep({ onLeave, onFinish }: { onLeave: () => void; onFinish: () => void }) {
  const progress = useOnboardingStore((state) => state.progress);
  const draft = useOnboardingStore((state) => state.draft);
  const url = publicUrl(progress.siteSlug ?? draft.slug);
  const editorHref = progress.siteId && progress.pageId ? `/sitios/${progress.siteId}/paginas/${progress.pageId}/editor` : "/sitios";
  const [copied, setCopied] = useState(false);

  const items = [
    {
      icon: QrCode,
      title: "Crea el QR de tu página",
      description: "Para tu local, tus tarjetas o tu vitrina.",
      href: "/enlaces",
      action: "Crear QR",
    },
    {
      icon: BarChart3,
      title: "Mira tus primeras visitas",
      description: "Visitas, clics y de dónde llegan.",
      href: "/analitica",
      action: "Ver analítica",
    },
    {
      icon: MessageSquare,
      title: "Recibe tu primer contacto",
      description: "Agrega el bloque «Formulario de contacto»: cada envío llega a tus Contactos.",
      href: editorHref,
      action: "Agregar formulario",
    },
    {
      icon: Globe,
      title: "Conecta tu dominio propio",
      description: "Usa tu propio dominio (tunegocio.cl). Disponible pronto.",
      href: null,
      action: null,
    },
  ];

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium text-foreground">
          {progress.published ? "Tu página ya está publicada en:" : "Tu página quedó guardada como borrador. Cuando la publiques estará en:"}
        </p>
        <p className="mt-1 break-all text-base font-semibold text-foreground">{url}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {progress.published ? (
            <Button asChild size="sm">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" aria-hidden="true" />
                Ver mi página
              </a>
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
            {copied ? "Copiado" : "Copiar dirección"}
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href={editorHref} onClick={onLeave}>
              Editar en el constructor
            </Link>
          </Button>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Primeros pasos">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.title} className="flex flex-col gap-2 rounded-lg border border-border p-4">
              <Icon className="size-5 text-primary" aria-hidden="true" />
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.description}</p>
              {item.href && item.action ? (
                <Button asChild size="sm" variant="secondary" className="mt-auto self-start">
                  <Link href={item.href} onClick={onLeave}>
                    {item.action}
                  </Link>
                </Button>
              ) : (
                <span className="mt-auto text-xs font-medium text-muted-foreground">Próximamente</span>
              )}
            </li>
          );
        })}
      </ul>

      <StepActions
        onNext={onFinish}
        nextLabel="Ir a mi panel"
      />
    </div>
  );
}
