"use client";

import { customDomainSchema } from "@impulza/validation";
import { Button, ErrorState, LoadingState } from "@impulza/ui";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, Circle, CircleCheck, ExternalLink, Globe, LayoutTemplate, Loader2, MessageSquare, QrCode, Rocket, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { createOrganization, listMyOrganizations } from "../../lib/api/organizations";
import { listPages, publishPage } from "../../lib/api/pages";
import { listBlocks, updateBlock } from "../../lib/api/blocks";
import { addSiteDomain } from "../../lib/api/domains";
import { getOnboardingLogoFile, setOnboardingLogo } from "../../lib/onboarding-logo";
import { uploadImage } from "../../lib/upload-image";
import { createSite } from "../../lib/api/sites";
import { useAnalyticsOverview } from "../../lib/hooks/use-analytics";
import { useContacts } from "../../lib/hooks/use-contacts";
import { useQrCodes } from "../../lib/hooks/use-qr-codes";
import { useSiteDomains } from "../../lib/hooks/use-domains";
import { IconInput } from "./fields";
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

const TASK_ICONS: Record<TaskKey, LucideIcon> = { organization: UserRound, site: Globe, template: LayoutTemplate, publish: Rocket };

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
  const [domain, setDomain] = useState("");
  const [logoNote, setLogoNote] = useState<string | null>(null);
  const [domainNote, setDomainNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const domainCheck = domain.trim() === "" ? null : customDomainSchema.safeParse(domain.trim().toLowerCase());
  const domainError = domainCheck && !domainCheck.success ? "Escribe un dominio válido, por ejemplo tunegocio.cl." : undefined;

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

      if (domainCheck?.success && domainNote?.tone !== "ok") {
        try {
          await addSiteDomain(organizationId, siteId, domainCheck.data);
          setDomainNote({
            tone: "ok",
            text: `Agregamos ${domainCheck.data}. Para activarlo, configura el registro DNS que te mostramos en la configuración del sitio.`,
          });
        } catch (caught) {
          const limited = getPlanLimitInfo(caught) !== null;
          setDomainNote({
            tone: "warn",
            text: limited
              ? "Tu plan actual no incluye dominio propio. Tu página se publica igual en la dirección de Impulza; puedes conectarlo después."
              : caught instanceof ApiError && caught.status === 409
                ? "Ese dominio ya está en uso. Tu página se publica igual; puedes conectar otro después."
                : "No pudimos agregar el dominio ahora. Tu página se publica igual; reinténtalo desde la configuración del sitio.",
          });
        }
      }

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

      // El logo elegido en el paso 1 se sube ahora que existe la organización y se pone como avatar del perfil. Si falla,
      // la publicación sigue: se puede cambiar después desde el constructor.
      const logoFile = getOnboardingLogoFile();
      if (logoFile) {
        try {
          const asset = await uploadImage(organizationId, logoFile, () => undefined);
          const blocks = await listBlocks(organizationId, siteId, pageId);
          const profile = blocks.find((block) => block.type === "profile");
          if (profile && asset.url) {
            const config = (profile.config ?? {}) as Record<string, unknown>;
            await updateBlock(organizationId, siteId, pageId, profile.id, {
              config: { ...config, avatar: { url: asset.url, alt: `Logo de ${draft.displayName}` } },
            });
          }
          setOnboardingLogo(null);
        } catch {
          setLogoNote("No pudimos subir tu logo ahora. Tu página se publica igual; puedes subirlo después en el constructor.");
        }
      }

      if (publish && !useOnboardingStore.getState().progress.published) {
        await step("publish", async () => {
          await publishPage(organizationId, siteId, pageId);
          // F10: las páginas que trae la plantilla (álbum, perfil, contacto…) se publican con la de inicio: sus botones
          // llevan a ellas y no pueden quedar apuntando a una página sin publicar.
          const pages = await listPages(organizationId, siteId);
          for (const page of pages) {
            if (page.id !== pageId && page.deletedAt === null && page.visibility === "PUBLIC" && page.status !== "PUBLISHED") {
              await publishPage(organizationId, siteId, page.id);
            }
          }
        });
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
      <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
        Vamos a crear tu página en{" "}
        <span className="inline-flex max-w-full items-center gap-1.5 break-all rounded-full bg-primary/10 px-3 py-1 font-medium text-foreground">
          <Globe className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          {publicUrl(draft.slug)}
        </span>{" "}
        con la plantilla «{chosen.name}». Todo queda editable en el constructor.
      </p>
      <ol className="flex flex-col gap-3" aria-label="Progreso de la publicación">
        {tasks.map((task) => {
          const status = statusOf(task);
          const TaskIcon = TASK_ICONS[task];
          return (
            <li
              key={task}
              className={`flex items-center gap-3 rounded-2xl border p-3.5 text-sm transition-colors ${
                status === "done" ? "border-success/40 bg-success/5" : status === "error" ? "border-danger/40 bg-danger/5" : "border-border bg-background"
              }`}
            >
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-muted-foreground">
                <TaskIcon className="size-5" />
              </span>
              {status === "done" ? (
                <Check className="size-4 text-success motion-pop" aria-hidden="true" />
              ) : status === "running" ? (
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
              ) : status === "error" ? (
                <Circle className="size-4 text-danger" aria-hidden="true" />
              ) : (
                <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="font-medium text-foreground">{TASK_LABELS[task]}</span>
              <span className="ml-auto text-muted-foreground">
                {status === "done" ? "Listo" : status === "running" ? "En curso…" : status === "error" ? "No se pudo" : "Pendiente"}
              </span>
            </li>
          );
        })}
      </ol>
      <section className="mt-5 rounded-2xl border border-border bg-surface/50 p-5" aria-labelledby="onboarding-domain-title">
        <h2 id="onboarding-domain-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Globe className="size-4 text-muted-foreground" aria-hidden="true" />
          Dominio propio (opcional)
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          ¿Tienes tunegocio.cl? Lo agregamos al publicar y te damos el registro DNS para activarlo. Si no lo tienes, sigue con la dirección de Impulza.
        </p>
        <IconInput
          icon={Globe}
          label="Tu dominio"
          placeholder="tunegocio.cl"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          error={domainError}
          disabled={running || domainNote?.tone === "ok"}
        />
        {domainNote ? (
          <p role="status" className={`mt-2 text-sm ${domainNote.tone === "ok" ? "text-foreground" : "text-danger"}`}>
            {domainNote.text}
          </p>
        ) : null}
      </section>
      <div aria-live="polite" className="mt-4">
        {logoNote ? <p className="mb-3 rounded-md border border-border bg-surface p-3 text-sm text-foreground">{logoNote}</p> : null}
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
        nextDisabled={planLimited || Boolean(domainError)}
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
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  const organizationId = progress.organizationId ?? activeOrganizationId ?? "";
  const siteId = progress.siteId ?? "";
  // Rango de 30 días fijado al montar (un valor estable: no cambia en cada render ni dispara consultas nuevas).
  const [{ from, today }] = useState(() => ({
    from: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    today: new Date().toISOString().slice(0, 10),
  }));

  // Seguimiento real: cada tarea se marca sola según lo que existe en tu cuenta (no son sugerencias estáticas).
  const qrQuery = useQrCodes(organizationId);
  const analyticsQuery = useAnalyticsOverview(organizationId, { from, to: today, siteId });
  const contactsQuery = useContacts(organizationId, {});
  const domainsQuery = useSiteDomains(organizationId, siteId);
  const queries = [qrQuery, analyticsQuery, contactsQuery, domainsQuery];
  const loading = Boolean(organizationId) && queries.some((query) => query.isPending);

  const items = [
    {
      icon: Rocket,
      title: "Publica tu página",
      description: progress.published ? "Tu página ya está en línea." : "Publícala desde el constructor cuando estés lista.",
      href: progress.published ? null : editorHref,
      action: "Abrir constructor",
      done: progress.published,
    },
    {
      icon: QrCode,
      title: "Crea el QR de tu página",
      description: "Para tu local, tus tarjetas o tu vitrina.",
      href: "/enlaces",
      action: "Crear QR",
      done: (qrQuery.data?.length ?? 0) > 0,
    },
    {
      icon: BarChart3,
      title: "Consigue tus primeras visitas",
      description: "Comparte tu dirección: aquí verás visitas, clics y de dónde llegan.",
      href: "/analitica",
      action: "Ver analítica",
      done: (analyticsQuery.data?.totals.pageViews ?? 0) > 0,
    },
    {
      icon: MessageSquare,
      title: "Recibe tu primer contacto",
      description: "Agrega el bloque «Formulario de contacto»: cada envío llega a tus Contactos.",
      href: editorHref,
      action: "Agregar formulario",
      done: (contactsQuery.data?.length ?? 0) > 0,
    },
    {
      icon: Globe,
      title: "Conecta tu dominio propio",
      description: "Usa tu propio dominio (tunegocio.cl) en lugar de la dirección de Impulza.",
      href: progress.siteId ? `/sitios/${progress.siteId}` : "/sitios",
      action: "Configurar dominio",
      done: (domainsQuery.data ?? []).some((domain) => domain.status === "VERIFIED"),
    },
  ];
  const doneCount = items.filter((item) => item.done).length;

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
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden="true"
          className="motion-pop flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-xl shadow-primary/30 ring-8 ring-primary/10"
        >
          <CircleCheck className="size-12" strokeWidth={2} />
        </span>
        <p className="text-lg font-semibold text-foreground">
          {progress.published ? "¡Tu página ya está en línea!" : "¡Tu página quedó lista para publicar!"}
        </p>
      </div>
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
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

      <div className="flex flex-col gap-2" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="font-medium text-foreground">
            {loading ? "Revisando tu avance…" : `${doneCount} de ${items.length} pasos completados`}
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={() => queries.forEach((query) => void query.refetch())}>
            Actualizar
          </Button>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Primeros pasos">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li
              key={item.title}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-background p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none"
            >
              <span
                aria-hidden="true"
                className={`mb-1 flex size-11 items-center justify-center rounded-xl ${item.done ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}
              >
                {item.done ? <Check className="size-5" /> : <Icon className="size-5" />}
              </span>
              <p className="text-sm font-semibold text-foreground">
                {item.title}
                {item.done ? <span className="ml-2 rounded-full border border-border-strong bg-surface px-2 py-0.5 text-xs font-medium text-foreground">Hecho</span> : null}
              </p>
              <p className="text-sm text-muted-foreground">{item.description}</p>
              {item.done ? null : item.href && item.action ? (
                <Button asChild size="sm" variant="secondary" className="mt-auto self-start">
                  <Link href={item.href} onClick={onLeave}>
                    {item.action}
                  </Link>
                </Button>
              ) : null}
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
