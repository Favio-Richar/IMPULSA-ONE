"use client";

import type { AdminMarketplaceListingResponse } from "@impulza/contracts";
import { MARKETPLACE_KIND_LABELS, MARKETPLACE_STATUS_LABELS, type MarketplaceStatus } from "@impulza/validation";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "../../../components/ui-bits";
import { adminApi } from "../../../lib/api";
import { ApiError } from "../../../lib/api-client";
import { formatDateTime } from "../../../lib/format";

// Revisión del marketplace (F10.6, ADR-029): aprobar, rechazar con motivo y retirar (que desinstala). Cada decisión queda auditada.

const TABS: Array<{ value: MarketplaceStatus; label: string }> = [
  { value: "IN_REVIEW", label: "Por revisar" },
  { value: "APPROVED", label: "Aprobadas" },
  { value: "REJECTED", label: "Rechazadas" },
  { value: "WITHDRAWN", label: "Retiradas" },
];

function errorText(error: unknown): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return "No pudimos aplicar la decisión. Intenta de nuevo.";
}

export default function MarketplaceReviewPage(): React.JSX.Element {
  const [status, setStatus] = useState<MarketplaceStatus>("IN_REVIEW");
  const query = useQuery({ queryKey: ["admin", "marketplace", status], queryFn: () => adminApi.marketplace({ status }), refetchInterval: 60_000 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Marketplace"
        description="Integraciones y plantillas que proponen los socios. Aprobar las pone en el directorio; retirar una la desinstala de todas las organizaciones. Todo queda auditado."
      />
      <div role="radiogroup" aria-label="Estado" className="inline-flex w-fit rounded-md border border-border bg-background p-0.5">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="radio"
            aria-checked={status === tab.value}
            onClick={() => setStatus(tab.value)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${status === tab.value ? "bg-foreground text-background" : "text-foreground hover:bg-surface"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <LoadingState label="Cargando publicaciones…" />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState title="Nada en esta lista" description="Cuando un socio publique algo, aparecerá aquí." />
      ) : (
        <ul className="flex flex-col gap-4">
          {query.data.items.map((listing) => (
            <ListingReview key={listing.id} listing={listing} status={status} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ListingReview({ listing, status }: { listing: AdminMarketplaceListingResponse; status: MarketplaceStatus }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin", "marketplace"] });
  const approve = useMutation({ mutationFn: () => adminApi.marketplaceApprove(listing.id), onSuccess: refresh });
  const reject = useMutation({ mutationFn: () => adminApi.marketplaceReject(listing.id, reason.trim()), onSuccess: refresh });
  const withdraw = useMutation({ mutationFn: () => adminApi.marketplaceWithdraw(listing.id, reason.trim()), onSuccess: refresh });
  const error = approve.error ?? reject.error ?? withdraw.error;
  const reasonOk = reason.trim().length >= 10;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{listing.name}</p>
          <p className="text-xs text-muted-foreground">
            {MARKETPLACE_KIND_LABELS[listing.kind]} · v{listing.version} · {listing.partnerName}
            {listing.submittedByOrganization ? ` · organización «${listing.submittedByOrganization.name}»` : ""} · enviada {formatDateTime(listing.createdAt)}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">{MARKETPLACE_STATUS_LABELS[listing.status]}</span>
      </div>
      <p className="text-sm text-foreground">{listing.summary}</p>
      <p className="text-sm text-muted-foreground">{listing.description}</p>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Qué pide (derivado de los datos)</p>
        <ul className="mt-1 list-disc pl-5 text-sm text-foreground">
          {listing.permissions.map((permission) => (
            <li key={permission}>{permission}</li>
          ))}
        </ul>
      </div>
      {listing.status === "APPROVED" ? <p className="text-xs text-muted-foreground">{listing.installs} instalaciones.</p> : null}
      {listing.reviewReason ? <p className="text-sm text-muted-foreground">Motivo: {listing.reviewReason}</p> : null}

      {status === "IN_REVIEW" || status === "APPROVED" || status === "WITHDRAWN" ? (
        <div className="flex flex-col gap-2">
          {status !== "WITHDRAWN" ? <Input label="Motivo (obligatorio para rechazar o retirar; lo ve el socio)" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /> : null}
          <div className="flex flex-wrap gap-2">
            {status === "IN_REVIEW" || status === "WITHDRAWN" ? (
              <Button type="button" size="sm" loading={approve.isPending} onClick={() => approve.mutate()}>
                {status === "WITHDRAWN" ? "Reactivar" : "Aprobar"}
              </Button>
            ) : null}
            {status === "IN_REVIEW" ? (
              <Button type="button" size="sm" variant="secondary" disabled={!reasonOk} loading={reject.isPending} onClick={() => reject.mutate()}>
                Rechazar
              </Button>
            ) : null}
            {status === "IN_REVIEW" || status === "APPROVED" ? (
              <Button type="button" size="sm" variant="secondary" disabled={!reasonOk} loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
                Retirar y desinstalar
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {errorText(error)}
        </p>
      ) : null}
    </li>
  );
}
