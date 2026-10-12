"use client";

import { Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import { Eye, Heart } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getSiteEngagement } from "../../lib/api/engagement";

const number = new Intl.NumberFormat("es-CL");

/** Vistas y «me gusta» acumulados de cada página del sitio (F10): lo que el negocio muestra y lo que su público responde. */
export function EngagementSummary({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const query = useQuery({ queryKey: ["site-engagement", organizationId, siteId], queryFn: () => getSiteEngagement(organizationId, siteId) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vistas y «me gusta»</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {query.isPending ? (
          <LoadingState label="Cargando cifras…" />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : query.data.pages.length === 0 ? (
          <EmptyState title="Todavía no hay páginas" description="Cuando publiques una página, aquí verás cuánta gente la vio y cuántos le dieron «me gusta»." />
        ) : (
          <>
            <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Eye className="size-4 text-muted-foreground" aria-hidden="true" />
                <strong className="tabular-nums">{number.format(query.data.totals.views)}</strong> vistas en total
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Heart className="size-4 text-muted-foreground" aria-hidden="true" />
                <strong className="tabular-nums">{number.format(query.data.totals.likes)}</strong> «me gusta» en total
              </span>
            </p>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {query.data.pages.map((page) => (
                <li key={page.pageId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-foreground">{page.isHome ? "Inicio" : page.slug}</span>
                  <span className="flex items-center gap-4 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <Eye className="size-4" aria-hidden="true" />
                      <span className="sr-only">Vistas:</span>
                      {number.format(page.views)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <Heart className="size-4" aria-hidden="true" />
                      <span className="sr-only">Me gusta:</span>
                      {number.format(page.likes)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
