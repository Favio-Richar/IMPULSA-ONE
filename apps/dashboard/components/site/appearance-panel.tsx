"use client";

import type { ThemeResponse } from "@impulza/contracts";
import { siteBackgroundSchema, themeTokensSchema, themeTokensToCssVariables, type ThemeTokens } from "@impulza/validation";
import { Button, cn, Dialog, ErrorState, LoadingState } from "@impulza/ui";
import { Check, Copy, Monitor, Pencil, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useSetSiteBackground, useAssignSiteTheme, useSiteBackground, useSiteTheme } from "../../lib/hooks/use-sites";
import { useDeleteTheme, useDuplicateTheme, useThemes } from "../../lib/hooks/use-themes";
import { BackgroundControls, backgroundErrorMessage, useBackgroundDraft } from "./background-controls";
import { type Device, PagePreview, previewButtonStyle } from "./page-preview";
import { ThemeEditor } from "./theme-editor";

/** Líneas del catálogo (PP4) en el orden en que se ofrecen; `null` agrupa los temas propios. */
const THEME_GROUPS: ReadonlyArray<{ family: ThemeResponse["family"]; label: string; description: string }> = [
  { family: "oscuro", label: "Oscuro", description: "Fondo oscuro de app de enlaces, con títulos editoriales." },
  { family: "minimal", label: "Minimal", description: "Fondo claro y todos los botones del mismo tono." },
  { family: "ejecutivo", label: "Ejecutivo", description: "Sobrio y formal, con títulos en serif." },
  { family: "vibrante", label: "Vibrante", description: "Juvenil y con más color." },
  { family: "clasico", label: "Clásicos", description: "Neutros, con las fuentes del dispositivo." },
  { family: null, label: "Tus temas", description: "Copias que personalizaste." },
];

/**
 * Apariencia del sitio: tema y fondo en UNA sola decisión, con una vista previa en vivo que refleja ambos a la vez (antes de guardar)
 * y un único botón «Aplicar apariencia». La lógica del fondo (legibilidad AA, capas, videos) es la de siempre; esto solo la reúne
 * con el tema. Aplicar llama a `assignSiteTheme` y/o `setSiteBackground` según lo que haya cambiado.
 */
export function AppearancePanel({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const themesQuery = useThemes(organizationId);
  const effectiveQuery = useSiteTheme(organizationId, siteId);
  const backgroundQuery = useSiteBackground(organizationId, siteId);

  if (themesQuery.isPending || effectiveQuery.isPending || backgroundQuery.isPending) {
    return <LoadingState label="Cargando la apariencia…" />;
  }
  if (themesQuery.isError || effectiveQuery.isError || backgroundQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void themesQuery.refetch();
          void effectiveQuery.refetch();
          void backgroundQuery.refetch();
        }}
      />
    );
  }

  return (
    <AppearanceEditor
      organizationId={organizationId}
      siteId={siteId}
      themes={themesQuery.data}
      effectiveThemeId={effectiveQuery.data.id}
      effectiveTokens={effectiveQuery.data.tokens}
      saved={siteBackgroundSchema.safeParse(backgroundQuery.data.background).data ?? null}
      videos={backgroundQuery.data.videos}
    />
  );
}

function AppearanceEditor({
  organizationId,
  siteId,
  themes,
  effectiveThemeId,
  effectiveTokens,
  saved,
  videos,
}: {
  organizationId: string;
  siteId: string;
  themes: ThemeResponse[];
  effectiveThemeId: string;
  effectiveTokens: unknown;
  saved: ReturnType<typeof siteBackgroundSchema.parse> | null;
  videos: Array<{ code: string; name: string; posterUrl: string }>;
}): React.JSX.Element {
  const assignTheme = useAssignSiteTheme(organizationId, siteId);
  const setBackground = useSetSiteBackground(organizationId, siteId);
  const [selectedThemeId, setSelectedThemeId] = useState(effectiveThemeId);
  const duplicateTheme = useDuplicateTheme(organizationId);
  const deleteTheme = useDeleteTheme(organizationId);
  const [editing, setEditing] = useState<ThemeResponse | null>(null);
  const [deleting, setDeleting] = useState<ThemeResponse | null>(null);
  const [device, setDevice] = useState<Device>("phone");
  const [outcome, setOutcome] = useState<{ theme: "ok" | "error" | null; background: "ok" | "error" | null } | null>(null);

  // El tema que se está viendo: el elegido en la grilla (aunque todavía no se haya aplicado) o, si no se puede leer, el aplicado.
  const effective = themeTokensSchema.parse(effectiveTokens);
  const selectedTheme = themes.find((theme) => theme.id === selectedThemeId);
  const viewedTheme = (selectedTheme && themeTokensSchema.safeParse(selectedTheme.tokens).data) || effective;

  const draft = useBackgroundDraft({ organizationId, theme: viewedTheme, saved, videos });
  const themeChanged = selectedThemeId !== effectiveThemeId;
  const backgroundChanged = !draft.unchanged;
  const pending = assignTheme.isPending || setBackground.isPending;
  const canApply = (themeChanged || backgroundChanged) && draft.ready && !pending;

  async function apply(): Promise<void> {
    setOutcome(null);
    // Los dos endpoints son independientes: si uno falla, el otro igual se aplica y se informa cada resultado por separado.
    const [themeResult, backgroundResult] = await Promise.allSettled([
      themeChanged ? assignTheme.mutateAsync(selectedThemeId) : Promise.resolve(null),
      backgroundChanged ? setBackground.mutateAsync(draft.current) : Promise.resolve(null),
    ]);
    setOutcome({
      theme: themeChanged ? (themeResult.status === "fulfilled" ? "ok" : "error") : null,
      background: backgroundChanged ? (backgroundResult.status === "fulfilled" ? "ok" : "error") : null,
    });
  }

  async function customize(theme: ThemeResponse): Promise<void> {
    // Un tema propio se edita tal cual; uno del catálogo (solo lectura) se duplica primero y se edita la copia.
    if (theme.source === "organization") {
      setEditing(theme);
      return;
    }
    const copy = await duplicateTheme.mutateAsync({ themeId: theme.id }).catch(() => null);
    if (copy) setEditing(copy);
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    const done = await deleteTheme.mutateAsync(deleting.id).then(
      () => true,
      () => false,
    );
    if (done) {
      // Si el tema borrado era el que se estaba viendo, se vuelve al aplicado.
      if (selectedThemeId === deleting.id) setSelectedThemeId(effectiveThemeId);
      setDeleting(null);
      deleteTheme.reset();
    }
  }

  const groups = THEME_GROUPS.map((group) => ({ ...group, themes: themes.filter((theme) => theme.family === group.family) })).filter(
    (group) => group.themes.length > 0,
  );

  return (
    <section aria-labelledby="apariencia-titulo" className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 id="apariencia-titulo" className="text-base font-semibold text-foreground">
          Apariencia
        </h2>
        <p className="text-sm text-muted-foreground">
          Elige el tema y el fondo: la vista previa muestra los dos a la vez. Nada se publica hasta que presiones «Aplicar apariencia».
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* En un teléfono la vista previa va primero (se ve el efecto de cada cambio sin bajar); en escritorio, a la derecha y fija. */}
        <div className="order-first lg:order-last">
          <div className="flex flex-col gap-3 lg:sticky lg:top-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">Vista previa</span>
              <div role="group" aria-label="Tamaño de la vista previa" className="inline-flex rounded-md border border-border p-0.5">
                {(
                  [
                    { value: "phone", label: "Teléfono", icon: <Smartphone className="size-4" aria-hidden="true" /> },
                    { value: "desktop", label: "Escritorio", icon: <Monitor className="size-4" aria-hidden="true" /> },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={device === option.value}
                    onClick={() => setDevice(option.value)}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-sm px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                      device === option.value ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-surface",
                    )}
                  >
                    {option.icon}
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <PagePreview theme={viewedTheme} background={draft.preview} device={device} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Tema</h3>
            {groups.map((group) => (
              <section key={group.family ?? "propios"} aria-labelledby={`temas-${group.family ?? "propios"}`}>
                <div className="mb-3">
                  <h4 id={`temas-${group.family ?? "propios"}`} className="text-sm font-semibold text-foreground">
                    {group.label}
                  </h4>
                  <p className="text-xs text-muted-foreground">{group.description}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.themes.map((theme) => (
                    <ThemeCard
                      key={theme.id}
                      theme={theme}
                      selected={theme.id === selectedThemeId}
                      current={theme.id === effectiveThemeId}
                      disabled={pending || duplicateTheme.isPending}
                      onSelect={() => setSelectedThemeId(theme.id)}
                      onCustomize={() => void customize(theme)}
                      onDelete={
                        theme.source === "organization"
                          ? () => {
                              deleteTheme.reset();
                              setDeleting(theme);
                            }
                          : null
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
            {duplicateTheme.isError ? (
              <p role="alert" className="text-sm text-danger">
                {duplicateTheme.error instanceof ApiError && duplicateTheme.error.status === 403
                  ? "Tu rol no permite crear temas."
                  : "No pudimos duplicar el tema. Intenta de nuevo."}
              </p>
            ) : null}
          </div>

          <section aria-labelledby="fondo-titulo" className="flex flex-col gap-4 border-t border-border pt-6">
            <div className="flex flex-col gap-1">
              <h3 id="fondo-titulo" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Fondo de la página
              </h3>
              <p className="text-sm text-muted-foreground">Lo primero que ve quien toca tu enlace. El texto siempre se ajusta para leerse bien sobre el fondo.</p>
            </div>
            <BackgroundControls organizationId={organizationId} draft={draft} />
          </section>

          <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite" className="flex flex-col gap-1 text-sm">
              <ApplyOutcome outcome={outcome} backgroundError={setBackground.error} />
              {!draft.ready ? <p className="text-muted-foreground">Revisa el fondo: todavía no se puede aplicar.</p> : null}
            </div>
            <Button type="button" onClick={() => void apply()} disabled={!canApply} loading={pending}>
              Aplicar apariencia
            </Button>
          </div>
        </div>
      </div>

      {editing ? (
        <ThemeEditor
          organizationId={organizationId}
          siteId={siteId}
          theme={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setSelectedThemeId(saved.id);
            setEditing(null);
            setOutcome({ theme: "ok", background: null });
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteThemeDialog
          theme={deleting}
          pending={deleteTheme.isPending}
          error={deleteTheme.error}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </section>
  );
}

function ApplyOutcome({
  outcome,
  backgroundError,
}: {
  outcome: { theme: "ok" | "error" | null; background: "ok" | "error" | null } | null;
  backgroundError: unknown;
}): React.JSX.Element | null {
  if (!outcome) return null;
  const { theme, background } = outcome;
  if (theme === "error" || background === "error") {
    return (
      <div role="alert" className="flex flex-col gap-0.5 text-danger">
        {theme === "error" ? <p>No pudimos aplicar el tema. Intenta de nuevo.</p> : null}
        {background === "error" ? <p>{backgroundErrorMessage(backgroundError)}</p> : null}
        {theme === "ok" ? <p className="text-foreground">El tema sí se aplicó.</p> : null}
        {background === "ok" ? <p className="text-foreground">El fondo sí se aplicó.</p> : null}
      </div>
    );
  }
  if (theme === "ok" && background === "ok") return <p className="text-success">Apariencia aplicada. Ya se ve en tu página pública.</p>;
  if (theme === "ok") return <p className="text-success">Tema aplicado. Ya se ve en tu página pública.</p>;
  if (background === "ok") return <p className="text-success">Fondo aplicado. Ya se ve en tu página pública.</p>;
  return null;
}

/**
 * Tarjeta de un tema: una mini-página real (avatar, nombre, botón y chip) con los tokens del tema, un check visible sobre la miniatura
 * al elegirla y «Actual» para el aplicado. `selected` = el que se está viendo; `current` = el ya aplicado en el sitio. Las acciones
 * (duplicar y personalizar; en un tema propio, editar y eliminar) son botones hermanos del que elige: nunca un botón dentro de otro.
 * Aparecen al pasar el mouse o al enfocar; en pantallas táctiles se ven siempre.
 */
function ThemeCard({
  theme,
  selected,
  current,
  disabled,
  onSelect,
  onCustomize,
  onDelete,
}: {
  theme: ThemeResponse;
  selected: boolean;
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
  onCustomize: () => void;
  onDelete: (() => void) | null;
}): React.JSX.Element {
  const tokens = theme.tokens as ThemeTokens;
  const vars = themeTokensToCssVariables(tokens);
  const own = theme.source === "organization";
  const actionClass =
    "inline-flex size-8 items-center justify-center rounded-md border border-black/10 bg-white/90 text-slate-900 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:cursor-wait disabled:opacity-60";

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-pressed={selected}
        data-theme-code={theme.code ?? undefined}
        className={cn(
          "flex w-full flex-col gap-2 rounded-lg border p-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:cursor-wait",
          selected ? "border-primary ring-2 ring-primary" : "border-border hover:-translate-y-0.5 hover:border-border-strong hover:shadow-sm",
        )}
        style={vars as React.CSSProperties}
      >
        <div
          aria-hidden="true"
          className="relative flex h-28 w-full flex-col justify-center gap-2 overflow-hidden rounded-md border px-3"
          style={{ background: "var(--site-color-background)", borderColor: "var(--site-color-border)", fontFamily: "var(--site-font-family)" }}
        >
          <div className="flex items-center gap-2">
            <span className="size-7 shrink-0 rounded-full" style={{ background: "var(--site-color-primary)" }} />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold" style={{ color: "var(--site-color-foreground)", fontFamily: "var(--site-font-heading)" }}>
                Tu nombre
              </span>
              <span className="truncate text-[10px]" style={{ color: "var(--site-color-muted-foreground)" }}>
                Lo que haces, en una línea
              </span>
            </span>
          </div>
          <span
            className="flex h-6 w-full items-center justify-center text-[10px] font-medium"
            style={{ ...previewButtonStyle(tokens.buttonStyle), borderRadius: "var(--site-radius)" }}
          >
            Escríbeme
          </span>
          <span
            className="inline-flex h-5 w-fit items-center border px-2 text-[10px]"
            style={{ background: "var(--site-color-surface)", borderColor: "var(--site-color-border)", color: "var(--site-color-foreground)", borderRadius: "var(--site-radius)" }}
          >
            Reservas
          </span>
          {selected ? (
            <span className="absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Check className="size-3.5" aria-hidden="true" />
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="truncate text-sm font-medium text-foreground">{theme.name}</span>
          {current ? <span className="shrink-0 text-xs font-medium text-primary">Actual</span> : null}
        </div>
      </button>

      <div className="absolute left-4 top-4 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <button
          type="button"
          onClick={onCustomize}
          disabled={disabled}
          className={actionClass}
          aria-label={own ? `Editar ${theme.name}` : `Duplicar y personalizar ${theme.name}`}
          title={own ? "Editar este tema" : "Duplicar y personalizar"}
        >
          {own ? <Pencil className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        </button>
        {onDelete ? (
          <button type="button" onClick={onDelete} disabled={disabled} className={actionClass} aria-label={`Eliminar ${theme.name}`} title="Eliminar este tema">
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Confirmación para eliminar un tema propio. El 409 («algún sitio lo tiene aplicado») se muestra tal cual lo manda el servidor. */
function DeleteThemeDialog({
  theme,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  theme: ThemeResponse;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const serverMessage = error instanceof ApiError ? (error.body as { message?: unknown } | undefined)?.message : undefined;
  const message = error ? (typeof serverMessage === "string" ? serverMessage : "No pudimos eliminar el tema.") : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={`Eliminar «${theme.name}»`}
      description="Esta acción no se puede deshacer. Si algún sitio usa este tema, primero cámbialo de tema."
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} loading={pending}>
            Eliminar tema
          </Button>
        </>
      }
    >
      {message ? (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Se elimina solo este tema propio; los del catálogo no se tocan.</p>
      )}
    </Dialog>
  );
}
