"use client";

import type { PageResponse } from "@impulza/contracts";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, seoMetaSchema, type SeoMeta } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Input, LoadingState, Select, Textarea } from "@impulza/ui";
import { CircleAlert, CircleCheck, Pencil, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { usePages, useUpdatePage } from "../../lib/hooks/use-pages";

const ROBOTS_OPTIONS = [
  { value: "index_follow", label: "Aparecer en Google y seguir enlaces" },
  { value: "noindex_follow", label: "No aparecer en Google, seguir enlaces" },
  { value: "index_nofollow", label: "Aparecer en Google, no seguir enlaces" },
  { value: "noindex_nofollow", label: "No aparecer ni seguir enlaces" },
] as const;

function readSeo(page: PageResponse): SeoMeta {
  const parsed = seoMetaSchema.safeParse(page.seoMeta ?? {});
  return parsed.success ? parsed.data : {};
}

/**
 * Panel de SEO del sitio: todas las páginas en un solo lugar, con la vista previa de cómo aparecen en un buscador, el estado
 * de título y descripción y la edición rápida. Guarda con el mismo endpoint de la página (`PATCH .../pages/:id`, `seoMeta`).
 * El resto (canonical y Open Graph) se edita en la pantalla de cada página.
 */
export function SeoOverview({ organizationId, siteId, siteSlug }: { organizationId: string; siteId: string; siteSlug: string }): React.JSX.Element {
  const pagesQuery = usePages(organizationId, siteId);

  if (pagesQuery.isPending) {
    return <LoadingState label="Cargando páginas…" />;
  }
  if (pagesQuery.isError) {
    return <ErrorState title="No pudimos cargar las páginas" onRetry={() => void pagesQuery.refetch()} />;
  }

  const pages = pagesQuery.data.filter((page) => page.deletedAt === null);
  if (pages.length === 0) {
    return <EmptyState title="Aún no hay páginas" description="Crea una página en la pestaña «Páginas» y aquí podrás cuidar cómo aparece en Google." />;
  }

  const withTitle = pages.filter((page) => Boolean(readSeo(page).title)).length;
  const withDescription = pages.filter((page) => Boolean(readSeo(page).description)).length;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="size-4" aria-hidden="true" />
            SEO del sitio
          </CardTitle>
          <CardDescription>
            Lo que Google y las redes muestran de tus páginas. Si dejas un campo vacío, usamos un valor automático a partir del contenido.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted-foreground">Páginas</dt>
              <dd className="text-2xl font-semibold text-foreground">{pages.length}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Con título propio</dt>
              <dd className="text-2xl font-semibold text-foreground">
                {withTitle} <span className="text-sm font-normal text-muted-foreground">de {pages.length}</span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Con descripción propia</dt>
              <dd className="text-2xl font-semibold text-foreground">
                {withDescription} <span className="text-sm font-normal text-muted-foreground">de {pages.length}</span>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <ul className="flex flex-col gap-4" aria-label="SEO por página">
        {pages.map((page) => (
          <li key={page.id}>
            <SeoPageRow organizationId={organizationId} siteId={siteId} siteSlug={siteSlug} page={page} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SeoPageRow({ organizationId, siteId, siteSlug, page }: { organizationId: string; siteId: string; siteSlug: string; page: PageResponse }): React.JSX.Element {
  const seo = readSeo(page);
  const updateMutation = useUpdatePage(organizationId, siteId, page.id);
  const [title, setTitle] = useState(seo.title ?? "");
  const [description, setDescription] = useState(seo.description ?? "");
  const [robots, setRobots] = useState<string>(seo.robots ?? "index_follow");
  const [error, setError] = useState<string | null>(null);

  const path = page.isHome ? `/${siteSlug}` : `/${siteSlug}/${page.slug}`;
  const dirty = title !== (seo.title ?? "") || description !== (seo.description ?? "") || robots !== (seo.robots ?? "index_follow");
  const titleOk = title.trim().length >= 10 && title.trim().length <= SEO_TITLE_MAX;
  const descriptionOk = description.trim().length >= 50 && description.trim().length <= SEO_DESCRIPTION_MAX;

  async function save(): Promise<void> {
    setError(null);
    const candidate: SeoMeta = {
      ...seo,
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      robots: robots as NonNullable<SeoMeta["robots"]>,
    };
    if (!title.trim()) delete candidate.title;
    if (!description.trim()) delete candidate.description;
    const parsed = seoMetaSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisa los campos de SEO.");
      return;
    }
    try {
      await updateMutation.mutateAsync({ seoMeta: parsed.data });
    } catch {
      setError("No pudimos guardar el SEO. Intenta de nuevo.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {page.isHome ? "Página de inicio" : `/${page.slug}`}
          {page.status === "PUBLISHED" ? null : <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">Borrador</span>}
          {page.visibility === "HIDDEN" ? <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">Oculta</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Vista previa tipo buscador: decorativa (el contenido accesible son los campos de abajo). */}
        <div aria-hidden="true" className="rounded-lg border border-border bg-surface/60 p-4">
          <p className="truncate text-xs text-muted-foreground">{path}</p>
          <p className="truncate text-lg text-primary">{title.trim() || "Título automático a partir de tu contenido"}</p>
          <p className="line-clamp-2 text-sm text-muted-foreground">{description.trim() || "Descripción automática a partir de tu contenido."}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Input
            label="Título para buscadores"
            value={title}
            maxLength={SEO_TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            helperText={`${title.trim().length}/${SEO_TITLE_MAX} · lo ideal es entre 10 y ${SEO_TITLE_MAX} caracteres`}
          />
          <Select label="Visibilidad en buscadores" options={ROBOTS_OPTIONS} value={robots} onChange={(event) => setRobots(event.target.value)} />
        </div>
        <Textarea
          label="Descripción"
          value={description}
          rows={3}
          maxLength={SEO_DESCRIPTION_MAX}
          onChange={(event) => setDescription(event.target.value)}
          helperText={`${description.trim().length}/${SEO_DESCRIPTION_MAX} · lo ideal es entre 50 y ${SEO_DESCRIPTION_MAX} caracteres`}
        />

        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Check ok={titleOk} okText="Título con buen largo" badText="Título pendiente o fuera del largo ideal" />
          <Check ok={descriptionOk} okText="Descripción con buen largo" badText="Descripción pendiente o fuera del largo ideal" />
        </ul>

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {updateMutation.isSuccess && !dirty ? (
          <p role="status" className="text-sm text-success">
            SEO guardado.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} loading={updateMutation.isPending} disabled={!dirty}>
            Guardar SEO
          </Button>
          <Link
            href={`/sitios/${siteId}/paginas/${page.id}`}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            <Pencil className="size-4" aria-hidden="true" />
            Más opciones (canonical, redes, IA)
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function Check({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }): React.JSX.Element {
  return (
    <li className="flex items-center gap-2 text-muted-foreground">
      {ok ? <CircleCheck className="size-4 text-success" aria-hidden="true" /> : <CircleAlert className="size-4 text-warning" aria-hidden="true" />}
      {ok ? okText : badText}
    </li>
  );
}
