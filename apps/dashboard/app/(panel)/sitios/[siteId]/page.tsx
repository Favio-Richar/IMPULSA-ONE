"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { publicSlugSchema } from "@impulza/validation";
import type { PageResponse } from "@impulza/contracts";
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
  Tabs,
  type TabItem,
} from "@impulza/ui";
import { ArrowDown, ArrowUp, ClipboardList, FileText, LayoutDashboard, Globe, Palette, Search, ShoppingBag, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ConfirmButton } from "../../../../components/confirm-button";
import { AppearancePanel } from "../../../../components/site/appearance-panel";
import { CustomDomains } from "../../../../components/site/custom-domains";
import { EngagementSummary } from "../../../../components/site/engagement-summary";
import { MeasurementSettings } from "../../../../components/site/measurement-settings";
import { FormsManager } from "../../../../components/site/forms-manager";
import { SeoOverview } from "../../../../components/site/seo-overview";
import { SiteWorkspace } from "../../../../components/site/site-workspace";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { ApiError } from "../../../../lib/api-client";
import {
  useDeletePage,
  usePages,
  useReorderPages,
  useRestorePage,
  useUpdatePage,
} from "../../../../lib/hooks/use-pages";
import { useSite, useUpdateSite } from "../../../../lib/hooks/use-sites";
import { DEFAULT_SITE_TAB, parseSiteTab, type SiteTab } from "../../../../lib/site-tabs";

const PAGE_VISIBILITY_LABEL: Record<string, string> = { PUBLIC: "Pública", HIDDEN: "Oculta" };
const PAGE_STATUS_LABEL: Record<string, string> = { DRAFT: "Borrador", PUBLISHED: "Publicada" };

export default function SitioDetallePage(): React.JSX.Element {
  const params = useParams<{ siteId: string }>();
  // `useSearchParams` (la pestaña activa vive en la URL) pide un límite de Suspense.
  return (
    <Suspense fallback={<LoadingState label="Cargando sitio…" />}>
      <SiteDetail siteId={params.siteId} />
    </Suspense>
  );
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

      <SiteSections organizationId={organizationId} siteId={siteId} name={site.name} slug={site.slug} />
    </div>
  );
}

const SITE_TABS: readonly (TabItem & { value: SiteTab })[] = [
  { value: "resumen", label: "Resumen", icon: <LayoutDashboard className="size-4" /> },
  { value: "apariencia", label: "Apariencia", icon: <Palette className="size-4" /> },
  { value: "paginas", label: "Páginas", icon: <FileText className="size-4" /> },
  { value: "comercio", label: "Comercio y reservas", icon: <ShoppingBag className="size-4" /> },
  { value: "contenido", label: "Contenido", icon: <Sparkles className="size-4" /> },
  { value: "formularios", label: "Formularios", icon: <ClipboardList className="size-4" /> },
  { value: "seo", label: "SEO", icon: <Search className="size-4" /> },
  { value: "dominio", label: "Dominio y medición", icon: <Globe className="size-4" /> },
];

/**
 * Las secciones del sitio en pestañas. La activa vive en la URL (`?tab=apariencia`): se puede compartir o recargar sin perder el
 * lugar. Solo se monta el contenido de la pestaña abierta, así que cada una consulta sus datos recién cuando se abre.
 */
function SiteSections({ organizationId, siteId, name, slug }: { organizationId: string; siteId: string; name: string; slug: string }): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseSiteTab(searchParams.get("tab"));

  function changeTab(next: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_SITE_TAB) params.delete("tab");
    else params.set("tab", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <Tabs tabs={SITE_TABS} value={tab} onValueChange={changeTab} label="Secciones del sitio">
      {tab === "resumen" ? (
        <div className="flex flex-col gap-6">
          <SiteWorkspace organizationId={organizationId} siteId={siteId} slug={slug} />
          <SiteSettingsForm organizationId={organizationId} siteId={siteId} name={name} slug={slug} />
          <EngagementSummary organizationId={organizationId} siteId={siteId} />
        </div>
      ) : null}
      {tab === "apariencia" ? <AppearancePanel organizationId={organizationId} siteId={siteId} /> : null}
      {tab === "paginas" ? <PagesSection organizationId={organizationId} siteId={siteId} /> : null}
      {tab === "comercio" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CatalogShortcut siteId={siteId} />
          <BookingShortcut siteId={siteId} />
          <SubscribeShortcut siteId={siteId} />
        </div>
      ) : null}
      {tab === "contenido" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CoursesShortcut siteId={siteId} />
          <MembersShortcut siteId={siteId} />
          <DigitalCardShortcut siteId={siteId} />
          <CampaignModeShortcut siteId={siteId} />
          <AbTestsShortcut siteId={siteId} />
        </div>
      ) : null}
      {tab === "formularios" ? <FormsManager organizationId={organizationId} siteId={siteId} /> : null}
      {tab === "seo" ? <SeoOverview organizationId={organizationId} siteId={siteId} siteSlug={slug} /> : null}
      {tab === "dominio" ? (
        <div className="flex flex-col gap-6">
          <CustomDomains organizationId={organizationId} siteId={siteId} />
          <MeasurementSettings organizationId={organizationId} siteId={siteId} />
        </div>
      ) : null}
    </Tabs>
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

/** Acceso a los miembros y páginas protegidas del sitio (F10.1), que tienen su propia pantalla. */
function MembersShortcut({ siteId }: { siteId: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Miembros</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Páginas solo para tus miembros y quién tiene acceso, sin contraseñas.</p>
        <Link href={`/sitios/${siteId}/miembros`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Gestionar miembros
        </Link>
      </CardContent>
    </Card>
  );
}

/** Acceso a los cursos del sitio (F10.3), que tienen su propia pantalla. */
function CoursesShortcut({ siteId }: { siteId: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cursos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Módulos y lecciones de texto o video, con avance por alumno y acceso por membresía.</p>
        <Link href={`/sitios/${siteId}/cursos`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Administrar cursos
        </Link>
      </CardContent>
    </Card>
  );
}

/** Acceso a la página de suscripción del sitio (extra F10), que tiene su propia pantalla. */
function SubscribeShortcut({ siteId }: { siteId: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Suscripción</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">La página a la que lleva el botón «Suscribirme» de tu portal: suscripción gratuita y planes de pago.</p>
        <Link href={`/sitios/${siteId}/suscripcion`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Administrar suscripción
        </Link>
      </CardContent>
    </Card>
  );
}

/** Acceso a la tarjeta digital del sitio (F10.4), que tiene su propia pantalla. */
function DigitalCardShortcut({ siteId }: { siteId: string }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tarjeta digital</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Tu tarjeta de presentación con QR, descarga de contacto (vCard) y pase para Apple y Google Wallet.</p>
        <Link href={`/sitios/${siteId}/tarjeta`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Administrar tarjeta
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
