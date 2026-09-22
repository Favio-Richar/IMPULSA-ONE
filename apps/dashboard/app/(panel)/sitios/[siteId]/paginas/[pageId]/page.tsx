"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { pageSlugSchema, seoMetaSchema, type SeoMeta } from "@impulza/validation";
import {
  Button,
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
import { useParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ConfirmButton } from "../../../../../../components/confirm-button";
import { useActiveOrgStore } from "../../../../../../lib/active-org-store";
import { ApiError } from "../../../../../../lib/api-client";
import {
  usePage,
  usePages,
  usePageVersions,
  usePublishPage,
  useRestorePageVersion,
  useUpdatePage,
} from "../../../../../../lib/hooks/use-pages";

const pageSettingsFormSchema = z.object({ slug: pageSlugSchema, visibility: z.enum(["PUBLIC", "HIDDEN"]) });

const ROBOTS_OPTIONS: Array<{ value: NonNullable<SeoMeta["robots"]>; label: string }> = [
  { value: "index_follow", label: "Indexar y seguir enlaces (recomendado)" },
  { value: "noindex_follow", label: "No indexar, pero seguir enlaces" },
  { value: "index_nofollow", label: "Indexar, pero no seguir enlaces" },
  { value: "noindex_nofollow", label: "No indexar ni seguir enlaces" },
];

export default function PaginaDetallePage(): React.JSX.Element {
  const params = useParams<{ siteId: string; pageId: string }>();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);

  if (!activeOrganizationId) {
    return (
      <EmptyState
        title="Selecciona una organización"
        description="Elige una organización arriba para ver esta página."
      />
    );
  }

  return <PageDetail organizationId={activeOrganizationId} siteId={params.siteId} pageId={params.pageId} />;
}

function PageDetail({
  organizationId,
  siteId,
  pageId,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
}): React.JSX.Element {
  const pageQuery = usePage(organizationId, siteId, pageId);

  if (pageQuery.isPending) {
    return <LoadingState label="Cargando página…" />;
  }

  if (pageQuery.isError) {
    if (pageQuery.error instanceof ApiError && pageQuery.error.status === 404) {
      return <ErrorState title="Página no encontrada" description="No existe, o está en la papelera." />;
    }
    return <ErrorState onRetry={() => pageQuery.refetch()} />;
  }

  const page = pageQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/sitios/${siteId}`} className="text-sm text-muted-foreground hover:underline">
            ← Sitio
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-foreground">{page.isHome ? "Inicio" : page.slug}</h1>
        </div>
        <Button asChild>
          <Link href={`/sitios/${siteId}/paginas/${pageId}/editor`}>Editar contenido</Link>
        </Button>
      </div>

      <PageSettingsForm organizationId={organizationId} siteId={siteId} pageId={pageId} page={page} />
      <PublishCard organizationId={organizationId} siteId={siteId} pageId={pageId} status={page.status} />
      <SeoForm
        organizationId={organizationId}
        siteId={siteId}
        pageId={pageId}
        seoMeta={seoMetaSchema.nullable().parse(page.seoMeta)}
      />
      <VersionHistory organizationId={organizationId} siteId={siteId} pageId={pageId} />
    </div>
  );
}

function PageSettingsForm({
  organizationId,
  siteId,
  pageId,
  page,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
  page: { slug: string; visibility: "PUBLIC" | "HIDDEN"; isHome: boolean };
}): React.JSX.Element {
  const updateMutation = useUpdatePage(organizationId, siteId, pageId);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<{ slug: string; visibility: "PUBLIC" | "HIDDEN" }>({
    resolver: zodResolver(pageSettingsFormSchema),
    defaultValues: { slug: page.slug, visibility: page.visibility },
  });

  async function onSubmit(values: { slug: string; visibility: "PUBLIC" | "HIDDEN" }): Promise<void> {
    try {
      await updateMutation.mutateAsync(values);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setError("slug", { message: "Ya existe una página con ese slug en este sitio." });
        return;
      }
      setError("root", { message: "No pudimos guardar los cambios." });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos de la página</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4 sm:flex-row sm:items-end" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="flex-1">
            <Input
              label="Slug"
              disabled={page.isHome}
              helperText={
                page.isHome
                  ? "La página de inicio no se puede renombrar."
                  : errors.slug
                    ? undefined
                    : "La URL de la página dentro del sitio."
              }
              error={errors.slug?.message}
              {...register("slug")}
            />
          </div>
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Visibilidad</span>
            <select
              className="h-10 rounded-md border border-border-strong bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              {...register("visibility")}
            >
              <option value="PUBLIC">Pública</option>
              <option value="HIDDEN">Oculta</option>
            </select>
          </label>
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

const STATUS_LABEL: Record<string, string> = { DRAFT: "Borrador — nunca publicada", PUBLISHED: "Publicada" };

function PublishCard({
  organizationId,
  siteId,
  pageId,
  status,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
  status: "DRAFT" | "PUBLISHED";
}): React.JSX.Element {
  const publishMutation = usePublishPage(organizationId, siteId, pageId);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Publicación</CardTitle>
        <Button loading={publishMutation.isPending} onClick={() => publishMutation.mutate()}>
          Publicar
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{STATUS_LABEL[status]}</p>
        {publishMutation.isError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            No pudimos publicar. Intenta de nuevo.
          </p>
        ) : null}
        {publishMutation.isSuccess ? <p className="mt-2 text-sm text-success">Publicado.</p> : null}
      </CardContent>
    </Card>
  );
}

interface SeoFormValues {
  title: string;
  description: string;
  canonicalPageSlug: string;
  robots: NonNullable<SeoMeta["robots"]>;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
}

function SeoForm({
  organizationId,
  siteId,
  pageId,
  seoMeta,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
  seoMeta: SeoMeta | null;
}): React.JSX.Element {
  const updateMutation = useUpdatePage(organizationId, siteId, pageId);
  const pagesQuery = usePages(organizationId, siteId);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<SeoFormValues>({
    defaultValues: {
      title: seoMeta?.title ?? "",
      description: seoMeta?.description ?? "",
      canonicalPageSlug: seoMeta?.canonicalPageSlug ?? "",
      robots: seoMeta?.robots ?? "index_follow",
      ogTitle: seoMeta?.openGraph?.title ?? "",
      ogDescription: seoMeta?.openGraph?.description ?? "",
      ogImage: seoMeta?.openGraph?.image ?? "",
    },
  });

  async function onSubmit(values: SeoFormValues): Promise<void> {
    const candidate: SeoMeta = {
      title: values.title.trim() || undefined,
      description: values.description.trim() || undefined,
      canonicalPageSlug: values.canonicalPageSlug || undefined,
      robots: values.robots,
      openGraph:
        values.ogTitle.trim() || values.ogDescription.trim() || values.ogImage.trim()
          ? {
              title: values.ogTitle.trim() || undefined,
              description: values.ogDescription.trim() || undefined,
              image: values.ogImage.trim() || undefined,
            }
          : undefined,
    };

    const parsed = seoMetaSchema.safeParse(candidate);
    if (!parsed.success) {
      setError("root", { message: parsed.error.issues[0]?.message ?? "Revisa los campos de SEO." });
      return;
    }

    try {
      await updateMutation.mutateAsync({ seoMeta: parsed.data });
    } catch {
      setError("root", { message: "No pudimos guardar el SEO. Intenta de nuevo." });
    }
  }

  const otherPages = (pagesQuery.data ?? []).filter((page) => page.id !== pageId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>SEO</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Todo es opcional: sin nada acá, el título y la descripción se completan solos con el contenido real de
          la página al publicar.
        </p>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Input label="Título" maxLength={70} error={errors.title?.message} {...register("title")} />
          <Input
            label="Descripción"
            maxLength={200}
            error={errors.description?.message}
            {...register("description")}
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Página canónica</span>
            <select
              className="h-10 rounded-md border border-border-strong bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              {...register("canonicalPageSlug")}
            >
              <option value="">Esta misma página</option>
              {otherPages.map((page) => (
                <option key={page.id} value={page.slug}>
                  {page.isHome ? `${page.slug} (inicio)` : page.slug}
                </option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">
              Usalo solo si esta página duplica el contenido de otra del mismo sitio.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Robots</span>
            <select
              className="h-10 rounded-md border border-border-strong bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              {...register("robots")}
            >
              {ROBOTS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="border-t border-border pt-4">
            <p className="mb-3 text-sm font-medium text-foreground">Open Graph (vista al compartir)</p>
            <div className="flex flex-col gap-4">
              <Input
                label="Título para compartir"
                maxLength={70}
                helperText="Si lo dejas vacío, usa el título de arriba."
                error={errors.ogTitle?.message}
                {...register("ogTitle")}
              />
              <Input
                label="Descripción para compartir"
                maxLength={200}
                helperText="Si la dejas vacía, usa la descripción de arriba."
                error={errors.ogDescription?.message}
                {...register("ogDescription")}
              />
              <Input
                label="Imagen para compartir"
                type="url"
                placeholder="https://…"
                error={errors.ogImage?.message}
                {...register("ogImage")}
              />
            </div>
          </div>

          {errors.root ? (
            <p role="alert" className="text-sm text-danger">
              {errors.root.message}
            </p>
          ) : null}
          {updateMutation.isSuccess ? <p className="text-sm text-success">SEO guardado.</p> : null}

          <Button type="submit" loading={updateMutation.isPending} disabled={!isDirty} className="self-start">
            Guardar SEO
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function VersionHistory({
  organizationId,
  siteId,
  pageId,
}: {
  organizationId: string;
  siteId: string;
  pageId: string;
}): React.JSX.Element {
  const versionsQuery = usePageVersions(organizationId, siteId, pageId);
  const restoreMutation = useRestorePageVersion(organizationId, siteId, pageId);

  if (versionsQuery.isPending) {
    return <LoadingState label="Cargando historial…" />;
  }

  if (versionsQuery.isError) {
    return <ErrorState onRetry={() => versionsQuery.refetch()} />;
  }

  const versions = versionsQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de versiones</CardTitle>
      </CardHeader>
      <CardContent>
        {versions.length === 0 ? (
          <EmptyState title="Todavía no se publicó ninguna versión" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versión</TableHead>
                <TableHead>Publicado</TableHead>
                <TableHead>Autor</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map((version, index) => (
                <TableRow key={version.id}>
                  <TableCell>#{version.versionNumber}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(version.publishedAt).toLocaleString("es")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {version.createdBy?.email ?? "Cuenta eliminada"}
                  </TableCell>
                  <TableCell>
                    <ConfirmButton
                      variant="ghost"
                      size="sm"
                      disabled={index === 0}
                      title={index === 0 ? "Ya es la versión vigente." : undefined}
                      confirmLabel={`¿Restaurar la versión #${version.versionNumber}?`}
                      loading={restoreMutation.isPending}
                      onConfirm={() => restoreMutation.mutate(version.id)}
                    >
                      Restaurar
                    </ConfirmButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {restoreMutation.isError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            No pudimos restaurar esa versión. Intenta de nuevo.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
