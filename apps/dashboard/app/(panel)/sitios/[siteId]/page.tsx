"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { publicSlugSchema, themeTokensToCssVariables, type ThemeTokens } from "@impulza/validation";
import type { PageResponse, ThemeResponse } from "@impulza/contracts";
import {
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@impulza/ui";
import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ConfirmButton } from "../../../../components/confirm-button";
import { BackgroundPicker } from "../../../../components/site/background-picker";
import { CustomDomains } from "../../../../components/site/custom-domains";
import { MeasurementSettings } from "../../../../components/site/measurement-settings";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { ApiError } from "../../../../lib/api-client";
import {
  useDeletePage,
  usePages,
  useReorderPages,
  useRestorePage,
  useUpdatePage,
} from "../../../../lib/hooks/use-pages";
import { useAssignSiteTheme, useSite, useSiteTheme, useUpdateSite } from "../../../../lib/hooks/use-sites";
import { useThemes } from "../../../../lib/hooks/use-themes";

const PAGE_VISIBILITY_LABEL: Record<string, string> = { PUBLIC: "Pública", HIDDEN: "Oculta" };
const PAGE_STATUS_LABEL: Record<string, string> = { DRAFT: "Borrador", PUBLISHED: "Publicada" };

export default function SitioDetallePage(): React.JSX.Element {
  const params = useParams<{ siteId: string }>();
  return <SiteDetail siteId={params.siteId} />;
}

function SiteDetail({ siteId }: { siteId: string }): React.JSX.Element {
  // Todas las rutas de la API cuelgan de `organizations/:organizationId/...` (ADR-002): no hay un
  // `GET /sites/:siteId` a secas, así que hace falta la organización activa para armar la URL.
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para ver este sitio."
      />
    );
  }

  return <SiteDetailContent organizationId={activeOrganizationId} siteId={siteId} />;
}

function SiteDetailContent({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const siteQuery = useSite(organizationId, siteId);

  if (siteQuery.isPending) {
    return <LoadingState label="Cargando sitio…" />;
  }

  if (siteQuery.isError) {
    if (siteQuery.error instanceof ApiError && siteQuery.error.status === 404) {
      return <ErrorState title="Sitio no encontrado" description="No existe, o es de otra organización." />;
    }
    return <ErrorState onRetry={() => siteQuery.refetch()} />;
  }

  const site = siteQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/sitios" className="text-sm text-muted-foreground hover:underline">
          ← Sitios
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-foreground">{site.name}</h1>
        <p className="text-sm text-muted-foreground">{site.slug}</p>
      </div>

      <SiteSettingsForm organizationId={organizationId} siteId={siteId} name={site.name} slug={site.slug} />
      <ThemePicker organizationId={organizationId} siteId={siteId} />
      <BackgroundPicker organizationId={organizationId} siteId={siteId} />
      <PagesSection organizationId={organizationId} siteId={siteId} />
      <BookingShortcut siteId={siteId} />
      <CatalogShortcut siteId={siteId} />
      <AbTestsShortcut siteId={siteId} />
      <CampaignModeShortcut siteId={siteId} />
      <CustomDomains organizationId={organizationId} siteId={siteId} />
      <MeasurementSettings organizationId={organizationId} siteId={siteId} />
    </div>
  );
}

function SiteSettingsForm({
  organizationId,
  siteId,
  name,
  slug,
}: {
  organizationId: string;
  siteId: string;
  name: string;
  slug: string;
}): React.JSX.Element {
  const updateMutation = useUpdateSite(organizationId, siteId);
  const formSchema = z.object({ name: z.string().min(2).max(120), slug: publicSlugSchema });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<{ name: string; slug: string }>({
    resolver: zodResolver(formSchema),
    defaultValues: { name, slug },
  });

  async function onSubmit(values: { name: string; slug: string }): Promise<void> {
    try {
      await updateMutation.mutateAsync(values);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError("slug", { message: "Ese slug ya está tomado. Elige otro." });
        return;
      }
      setError("root", { message: "No pudimos guardar los cambios." });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos del sitio</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex-1">
            <Input label="Nombre" error={errors.name?.message} {...register("name")} />
          </div>
          <div className="flex-1">
            <Input
              label="Slug"
              helperText={errors.slug ? undefined : "Cambiarlo deja una redirección desde el anterior."}
              error={errors.slug?.message}
              {...register("slug")}
            />
          </div>
          <Button type="submit" loading={updateMutation.isPending} disabled={!isDirty}>
            Guardar
          </Button>
        </form>
        {errors.root ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {errors.root.message}
          </p>
        ) : null}
        {updateMutation.isSuccess ? <p className="mt-2 text-sm text-success">Guardado.</p> : null}
      </CardContent>
    </Card>
  );
}

function ThemePicker({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const themesQuery = useThemes(organizationId);
  const effectiveThemeQuery = useSiteTheme(organizationId, siteId);
  const assignMutation = useAssignSiteTheme(organizationId, siteId);

  if (themesQuery.isPending || effectiveThemeQuery.isPending) {
    return <LoadingState label="Cargando temas…" />;
  }

  if (themesQuery.isError || effectiveThemeQuery.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void themesQuery.refetch();
          void effectiveThemeQuery.refetch();
        }}
      />
    );
  }

  const effectiveThemeId = effectiveThemeQuery.data.id;
  const groups = THEME_GROUPS.map((group) => ({
    ...group,
    themes: themesQuery.data.filter((theme) => theme.family === group.family),
  })).filter((group) => group.themes.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apariencia</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.family ?? "propios"} aria-labelledby={`temas-${group.family ?? "propios"}`}>
            <div className="mb-3">
              <h3 id={`temas-${group.family ?? "propios"}`} className="text-sm font-semibold text-foreground">
                {group.label}
              </h3>
              <p className="text-xs text-muted-foreground">{group.description}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.themes.map((theme) => (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  selected={theme.id === effectiveThemeId}
                  disabled={assignMutation.isPending}
                  onSelect={() => assignMutation.mutate(theme.id)}
                />
              ))}
            </div>
          </section>
        ))}
        {assignMutation.isError ? (
          <p role="alert" className="text-sm text-danger">
            No pudimos aplicar el tema. Intenta de nuevo.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Líneas del catálogo (PP4) en el orden en que se ofrecen; `null` agrupa los temas propios. */
const THEME_GROUPS: ReadonlyArray<{ family: ThemeResponse["family"]; label: string; description: string }> = [
  { family: "oscuro", label: "Oscuro", description: "Fondo oscuro de app de enlaces, con títulos editoriales." },
  { family: "minimal", label: "Minimal", description: "Fondo claro y todos los botones del mismo tono." },
  { family: "ejecutivo", label: "Ejecutivo", description: "Sobrio y formal, con títulos en serif." },
  { family: "vibrante", label: "Vibrante", description: "Juvenil y con más color." },
  { family: "clasico", label: "Clásicos", description: "Neutros, con las fuentes del dispositivo." },
  { family: null, label: "Tus temas", description: "Copias que personalizaste." },
];

function ThemeCard({
  theme,
  selected,
  disabled,
  onSelect,
}: {
  theme: ThemeResponse;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const tokens = theme.tokens as ThemeTokens;
  const vars = themeTokensToCssVariables(tokens);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || selected}
      data-theme-code={theme.code ?? undefined}
      className={
        "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors disabled:cursor-default " +
        (selected ? "border-primary ring-2 ring-primary" : "border-border hover:border-border-strong")
      }
      style={vars as React.CSSProperties}
    >
      {/* Muestra con la pareja tipográfica real del tema (títulos + texto) y su botón. */}
      <div
        aria-hidden="true"
        className="flex h-16 w-full items-center gap-3 rounded-md border px-3"
        style={{
          background: "var(--site-color-background)",
          borderColor: "var(--site-color-border)",
        }}
      >
        <span
          className="text-2xl font-semibold leading-none"
          style={{ color: "var(--site-color-foreground)", fontFamily: "var(--site-font-heading)" }}
        >
          Aa
        </span>
        <span
          className="text-xs"
          style={{ color: "var(--site-color-muted-foreground)", fontFamily: "var(--site-font-family)" }}
        >
          Texto
        </span>
        <span
          className="ml-auto h-6 w-10 rounded-[var(--site-radius)]"
          style={
            tokens.buttonStyle === "outline"
              ? { border: "2px solid var(--site-color-primary)" }
              : tokens.buttonStyle === "mono"
                ? { border: "1px solid var(--site-color-border)", background: "var(--site-color-surface)" }
              : tokens.buttonStyle === "glass"
                ? {
                    border: "1px solid color-mix(in srgb, var(--site-color-foreground) 24%, transparent)",
                    background: "color-mix(in srgb, var(--site-color-foreground) 12%, transparent)",
                  }
                : { background: "var(--site-color-primary)" }
          }
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{theme.name}</span>
        {selected ? <span className="text-xs font-medium text-primary">Actual</span> : null}
      </div>
    </button>
  );
}

function PagesSection({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const pagesQuery = usePages(organizationId, siteId);
  const reorderMutation = useReorderPages(organizationId, siteId);
  const [justDeleted, setJustDeleted] = useState<{ id: string; slug: string } | null>(null);

  if (pagesQuery.isPending) {
    return <LoadingState label="Cargando páginas…" />;
  }

  if (pagesQuery.isError) {
    return <ErrorState onRetry={() => pagesQuery.refetch()} />;
  }

  const pages = [...pagesQuery.data].sort((a, b) => a.position - b.position);

  function movePage(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= pages.length) {
      return;
    }
    const reordered = [...pages];
    const [moved] = reordered.splice(index, 1);
    if (!moved) {
      return;
    }
    reordered.splice(target, 0, moved);
    reorderMutation.mutate(reordered.map((page) => page.id));
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Páginas</CardTitle>
        <Button asChild size="sm">
          <Link href={`/sitios/${siteId}/paginas/nueva`}>Crear página</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {justDeleted ? (
          <UndoDeleteBanner
            organizationId={organizationId}
            siteId={siteId}
            deleted={justDeleted}
            onDone={() => setJustDeleted(null)}
          />
        ) : null}

        {pages.length === 0 ? (
          <EmptyState title="Este sitio todavía no tiene páginas" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Visibilidad</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((page, index) => (
                <PageRow
                  key={page.id}
                  organizationId={organizationId}
                  siteId={siteId}
                  page={page}
                  canMoveUp={index > 0}
                  canMoveDown={index < pages.length - 1}
                  onMoveUp={() => movePage(index, -1)}
                  onMoveDown={() => movePage(index, 1)}
                  onDeleted={() => setJustDeleted({ id: page.id, slug: page.slug })}
                />
              ))}
            </TableBody>
          </Table>
        )}

        {reorderMutation.isError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            No pudimos guardar el nuevo orden. Intenta de nuevo.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PageRow({
  organizationId,
  siteId,
  page,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDeleted,
}: {
  organizationId: string;
  siteId: string;
  page: PageResponse;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDeleted: () => void;
}): React.JSX.Element {
  const updateMutation = useUpdatePage(organizationId, siteId, page.id);
  const deleteMutation = useDeletePage(organizationId, siteId);

  return (
    <TableRow>
      <TableCell>
        <Link href={`/sitios/${siteId}/paginas/${page.id}`} className="font-medium text-primary hover:underline">
          {page.isHome ? `${page.slug} (inicio)` : page.slug}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">{PAGE_VISIBILITY_LABEL[page.visibility]}</TableCell>
      <TableCell className="text-muted-foreground">{PAGE_STATUS_LABEL[page.status]}</TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Subir"
            disabled={!canMoveUp}
            onClick={onMoveUp}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Bajar"
            disabled={!canMoveDown}
            onClick={onMoveDown}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={updateMutation.isPending}
            onClick={() =>
              updateMutation.mutate({ visibility: page.visibility === "PUBLIC" ? "HIDDEN" : "PUBLIC" })
            }
          >
            {page.visibility === "PUBLIC" ? "Ocultar" : "Mostrar"}
          </Button>
          <ConfirmButton
            variant="ghost"
            size="sm"
            disabled={page.isHome}
            title={page.isHome ? "La página de inicio no se puede eliminar." : undefined}
            confirmLabel={`¿Mandar "${page.slug}" a la papelera?`}
            loading={deleteMutation.isPending}
            onConfirm={() => deleteMutation.mutate(page.id, { onSuccess: onDeleted })}
          >
            Eliminar
          </ConfirmButton>
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * La API no tiene un endpoint para listar la papelera (F2.3: `GET /pages` filtra `deletedAt` en
 * el servidor) — la única forma de restaurar una página es conociendo su id, y la única vez que
 * este panel lo conoce sin haberlo guardado en ningún lado es justo después de borrarla. Por eso
 * "deshacer" vive acá, con el id en memoria, y no como una pantalla de "papelera" que la API no
 * puede respaldar todavía.
 */
function UndoDeleteBanner({
  organizationId,
  siteId,
  deleted,
  onDone,
}: {
  organizationId: string;
  siteId: string;
  deleted: { id: string; slug: string };
  onDone: () => void;
}): React.JSX.Element {
  const restoreMutation = useRestorePage(organizationId, siteId);

  return (
    <div className="mb-3 flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <span>
        Página <span className="font-medium">{deleted.slug}</span> movida a la papelera.
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          loading={restoreMutation.isPending}
          onClick={() => restoreMutation.mutate(deleted.id, { onSuccess: onDone })}
        >
          Deshacer
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cerrar
        </Button>
      </div>
    </div>
  );
}

/** Acceso a la configuración de reservas (F5.1), que tiene su propia pantalla. */
function BookingShortcut({ siteId }: { siteId: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reservas</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Horario de atención, servicios con su duración y días bloqueados.</p>
        <Link href={`/sitios/${siteId}/reservas`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Configurar reservas
        </Link>
      </CardContent>
    </Card>
  );
}

/** Acceso a las pruebas A/B del sitio (F6.5), que tienen su propia pantalla. */
function AbTestsShortcut({ siteId }: { siteId: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pruebas A/B</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Compara dos versiones de un botón o del encabezado y quédate con la que consigue más clics.</p>
        <Link href={`/sitios/${siteId}/pruebas`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Ver pruebas
        </Link>
      </CardContent>
    </Card>
  );
}

/** Acceso al modo campaña (F7.7): páginas temporales con fecha de inicio y fin. */
function CampaignModeShortcut({ siteId }: { siteId: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Modo campaña</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Programa una página para una fecha especial: aparece sola, puede tomar tu inicio y desaparece al terminar.</p>
        <Link href={`/sitios/${siteId}/modo-campana`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Ver campañas
        </Link>
      </CardContent>
    </Card>
  );
}

/** Acceso al catálogo de productos (F5.5), que tiene su propia pantalla. */
function CatalogShortcut({ siteId }: { siteId: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Catálogo</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Productos físicos, digitales o servicios, con foto, precio, stock y enlace de pago.</p>
        <Link href={`/sitios/${siteId}/catalogo`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Administrar catálogo
        </Link>
      </CardContent>
    </Card>
  );
}
