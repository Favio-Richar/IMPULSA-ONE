"use client";

import { Button, buttonVariants, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { useQueries, useQuery } from "@tanstack/react-query";
import { NetworkIcon } from "@impulza/blocks-renderer";
import { BarChart3, CalendarDays, Check, Copy, ExternalLink, Images, Inbox, Mail, Plus, Share2, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useId, useState, useSyncExternalStore } from "react";
import { shareIntents } from "../../lib/share-intents";
import { listBlocks } from "../../lib/api/blocks";
import { listCourses } from "../../lib/api/courses";
import { env } from "../../lib/env";
import { usePages } from "../../lib/hooks/use-pages";
import { buildWorkspaceAreas, summarizePublication, type WorkspacePage } from "../../lib/site-workspace";
import { QrCodeImage } from "../qr-code-image";

const ALWAYS = [
  { href: "/medios", label: "Biblioteca de fotos y videos", icon: Images },
  { href: "/contactos", label: "Mensajes y contactos", icon: Inbox },
  { href: "/reservas", label: "Agenda de citas", icon: CalendarDays },
  { href: "/pedidos", label: "Pedidos", icon: ShoppingBag },
  { href: "/analitica", label: "Estadísticas", icon: BarChart3 },
] as const;

/** Texto que acompaña el enlace al compartir. Neutro: sirve para un negocio, una marca o una persona. */
const SHARE_TEXT = "Te comparto mi página";

/**
 * «Mi sistema» (F10): un solo lugar para administrar el sitio según lo que contiene. Cada área (fotos, servicios,
 * reservas, tienda…) muestra cuánto tiene y lleva directo a donde se edita; lo que el sitio todavía no usa se
 * sugiere. Nada se duplica: los accesos abren las pantallas de siempre.
 */
export function SiteWorkspace({ organizationId, siteId, slug }: { organizationId: string; siteId: string; slug: string }): React.JSX.Element {
  const pagesQuery = usePages(organizationId, siteId);
  const pages = (pagesQuery.data ?? []).filter((page) => page.deletedAt === null);
  const blockQueries = useQueries({
    queries: pages.map((page) => ({
      queryKey: ["blocks", organizationId, siteId, page.id] as const,
      queryFn: () => listBlocks(organizationId, siteId, page.id),
    })),
  });
  // Los cursos piden el permiso `course.manage`: sin él la consulta falla y el área simplemente no aparece.
  const coursesQuery = useQuery({ queryKey: ["courses", organizationId, siteId], queryFn: () => listCourses(organizationId, siteId), retry: false });
  const [copied, setCopied] = useState(false);
  const shareLabelId = useId();
  // Solo en el navegador: en el servidor no existe `navigator` y así no hay diferencia de hidratación.
  const canNativeShare = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.share === "function",
    () => false,
  );
  const url = `${env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/+$/, "")}/${slug}`;

  if (pagesQuery.isPending) return <LoadingState label="Preparando tu sistema…" />;
  if (pagesQuery.isError) return <ErrorState onRetry={() => pagesQuery.refetch()} />;
  if (pages.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState title="Todavía no tienes páginas" description="Crea tu primera página y aquí verás todo lo que puedes administrar." />
        </CardContent>
      </Card>
    );
  }

  const loading = blockQueries.some((query) => query.isPending);
  const workspacePages: WorkspacePage[] = pages.map((page, index) => ({
    id: page.id,
    slug: page.slug,
    isHome: page.isHome,
    status: page.status,
    blocks: (blockQueries[index]?.data ?? []).map((block) => ({ type: block.type, visible: block.visible })),
  }));
  const areas = buildWorkspaceAreas(siteId, workspacePages, { courses: coursesQuery.data ? coursesQuery.data.items.length : null });
  const publication = summarizePublication(workspacePages);

  /** Hoja de compartir del sistema (teléfono, Safari, Edge): ahí aparecen también las apps que la persona tiene instaladas. */
  async function nativeShare(): Promise<void> {
    try {
      await navigator.share({ title: SHARE_TEXT, url });
    } catch {
      // Cancelar la hoja no es un error que mostrar.
    }
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mi sistema</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {publication.published} de {publication.total} {publication.total === 1 ? "página publicada" : "páginas publicadas"}
              {publication.drafts > 0 ? ` · ${publication.drafts} en borrador` : ""}
            </p>
            <p className="break-all text-sm font-medium text-foreground">{url}</p>
            <div className="flex flex-wrap gap-2">
              <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                <ExternalLink className="size-4" aria-hidden="true" /> Ver mi página
              </a>
              <Button type="button" variant="secondary" size="sm" onClick={() => void copyLink()}>
                {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                {copied ? "Enlace copiado" : "Copiar enlace"}
              </Button>
              {canNativeShare ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => void nativeShare()}>
                  <Share2 className="size-4" aria-hidden="true" /> Más opciones
                </Button>
              ) : null}
            </div>
            <div className="mt-1 flex flex-col gap-2">
              <p id={shareLabelId} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Compartir en
              </p>
              <ul aria-labelledby={shareLabelId} className="flex flex-wrap gap-2" data-testid="share-intents">
                {shareIntents(url, SHARE_TEXT).map((intent) => (
                  <li key={intent.id}>
                    <a
                      href={intent.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Compartir en ${intent.label} (se abre en una pestaña nueva)`}
                      title={intent.label}
                      className="flex size-10 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:border-border-strong hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                    >
                      {intent.id === "email" ? <Mail className="size-5" aria-hidden="true" /> : <NetworkIcon network={intent.id} className="size-5" />}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="shrink-0 self-start rounded-md border border-border bg-white p-2" aria-label="Código QR de tu página">
            <QrCodeImage value={url} foreground="#111111" background="#ffffff" size={112} />
          </div>
        </div>

        {loading ? (
          <LoadingState label="Revisando el contenido de tus páginas…" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Áreas que puedes administrar">
            {areas.map((area) => (
              <li key={area.id} className="flex flex-col justify-between gap-3 rounded-md border border-border bg-surface p-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {area.title}
                    {area.state === "ok" ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{area.count}</span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Sin usar</span>
                    )}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{area.description}</p>
                </div>
                <Link href={area.href} className={buttonVariants({ variant: area.state === "ok" ? "secondary" : "ghost", size: "sm" })}>
                  {area.state === "suggest" ? <Plus className="size-4" aria-hidden="true" /> : null}
                  {area.cta}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Siempre a mano</p>
          <ul className="flex flex-wrap gap-2">
            {ALWAYS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  <item.icon className="size-4" aria-hidden="true" /> {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
