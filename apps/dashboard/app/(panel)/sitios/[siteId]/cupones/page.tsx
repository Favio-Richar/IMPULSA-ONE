"use client";

import type { CouponResponse } from "@impulza/contracts";
import { Button, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import type { CouponStatus } from "@impulza/validation";
import { CalendarClock, CircleCheck, CirclePause, CircleSlash, Plus, TicketPercent, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { priceLabel } from "../../../../../components/bookings/bookable-services";
import { ConfirmButton } from "../../../../../components/confirm-button";
import { CouponEditorDialog } from "../../../../../components/coupons/coupon-editor-dialog";
import { useActiveOrgStore } from "../../../../../lib/active-org-store";
import { ApiError } from "../../../../../lib/api-client";
import { useCoupons, useDeleteCoupon, useSaveCoupon } from "../../../../../lib/hooks/use-coupons";
import { formatCampaignDateTime } from "../../../../../lib/page-campaign-messages";
import { useSite } from "../../../../../lib/hooks/use-sites";

// Cupones del sitio (F7.8b, ADR-023): códigos de descuento que el cliente escribe al pedir.

// Estado con ícono y texto (nunca solo color).
const STATUS_META: Record<CouponStatus, { label: string; icon: LucideIcon; className: string }> = {
  active: { label: "Vigente", icon: CircleCheck, className: "border-success/40 bg-success/10 text-foreground" },
  scheduled: { label: "Programado", icon: CalendarClock, className: "border-border bg-surface text-foreground" },
  expired: { label: "Vencido", icon: CircleSlash, className: "border-border bg-surface text-muted-foreground" },
  exhausted: { label: "Agotado", icon: CircleSlash, className: "border-border bg-surface text-muted-foreground" },
  paused: { label: "Pausado", icon: CirclePause, className: "border-border bg-surface text-muted-foreground" },
};

export default function CuponesPage(): React.JSX.Element {
  const params = useParams<{ siteId: string }>();
  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!activeOrganizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver sus cupones." />;
  }
  return <Coupons organizationId={activeOrganizationId} siteId={params.siteId} />;
}

function benefit(coupon: CouponResponse): string {
  if (coupon.kind === "percent") return `${coupon.percentOff} % de descuento`;
  return `${priceLabel(coupon.amountOff, coupon.currency) ?? ""} de descuento`;
}

function conditions(coupon: CouponResponse): string[] {
  const list: string[] = [];
  if (coupon.minSubtotal !== null) list.push(`Compra mínima ${priceLabel(coupon.minSubtotal, coupon.currency)}`);
  if (coupon.kind === "percent" && coupon.currency !== null && coupon.minSubtotal === null) list.push(`Solo en ${coupon.currency}`);
  if (coupon.startsAt) list.push(`Desde ${formatCampaignDateTime(coupon.startsAt)}`);
  if (coupon.endsAt) list.push(`Hasta ${formatCampaignDateTime(coupon.endsAt)}`);
  return list;
}

function Coupons({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const siteQuery = useSite(organizationId, siteId);
  const couponsQuery = useCoupons(organizationId, siteId);
  // `undefined` = cerrado; `null` = nuevo; un cupón = editándolo.
  const [editing, setEditing] = useState<CouponResponse | null | undefined>(undefined);

  if (siteQuery.isPending || couponsQuery.isPending) {
    return <LoadingState label="Cargando cupones…" />;
  }
  if (siteQuery.isError || couponsQuery.isError) {
    const error = siteQuery.error ?? couponsQuery.error;
    if (error instanceof ApiError && error.status === 404) {
      return <ErrorState title="Sitio no encontrado" description="No existe, o es de otra organización." />;
    }
    return (
      <ErrorState
        onRetry={() => {
          void siteQuery.refetch();
          void couponsQuery.refetch();
        }}
      />
    );
  }

  const coupons = couponsQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link href={`/sitios/${siteId}/catalogo`} className="text-sm text-muted-foreground hover:underline">
            ← Catálogo de {siteQuery.data.name}
          </Link>
          <h1 className="text-lg font-semibold text-foreground">Cupones</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Códigos que tus clientes escriben al pedir: un porcentaje o un monto de descuento, con compra mínima, fechas y tope de usos si quieres. El
            descuento se calcula en el servidor y Mercado Pago cobra el total ya descontado.
          </p>
        </div>
        <Button type="button" className="shrink-0" onClick={() => setEditing(null)}>
          <Plus className="size-4" aria-hidden="true" />
          Nuevo cupón
        </Button>
      </div>

      {coupons.length === 0 ? (
        <EmptyState
          title="Todavía no hay cupones"
          description="Crea uno para una promoción, un cliente frecuente o una campaña en redes."
          action={
            <Button type="button" size="sm" onClick={() => setEditing(null)}>
              Crear el primero
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Cupones">
          {coupons.map((coupon) => (
            <CouponCard key={coupon.id} organizationId={organizationId} siteId={siteId} coupon={coupon} onEdit={() => setEditing(coupon)} />
          ))}
        </ul>
      )}

      {editing !== undefined ? (
        <CouponEditorDialog
          key={editing?.id ?? "nuevo"}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(undefined);
          }}
          organizationId={organizationId}
          siteId={siteId}
          coupon={editing}
        />
      ) : null}
    </div>
  );
}

function CouponCard({ organizationId, siteId, coupon, onEdit }: { organizationId: string; siteId: string; coupon: CouponResponse; onEdit: () => void }): React.JSX.Element {
  const save = useSaveCoupon(organizationId, siteId);
  const remove = useDeleteCoupon(organizationId, siteId);
  const meta = STATUS_META[coupon.status];
  const StatusIcon = meta.icon;
  const error = save.error ?? remove.error;
  const errorText =
    error instanceof ApiError && error.status === 403 ? "Tu rol no permite cambiar los cupones." : error ? "No se pudo guardar. Intenta de nuevo." : null;
  const uses = coupon.maxRedemptions === null ? `${coupon.redemptionCount} ${coupon.redemptionCount === 1 ? "uso" : "usos"}` : `${coupon.redemptionCount} de ${coupon.maxRedemptions} usos`;
  const given = coupon.discountGiven.map((row) => priceLabel(row.amount, row.currency)).join(" + ");

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 shadow-xs sm:flex-row sm:items-start sm:justify-between" data-coupon={coupon.code}>
      <div className="flex min-w-0 gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface text-muted-foreground">
          <TicketPercent className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold text-foreground">{coupon.code}</span>
            <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${meta.className}`}>
              <StatusIcon className="size-3.5" aria-hidden="true" />
              {meta.label}
            </span>
          </p>
          <p className="text-sm font-medium text-foreground">{benefit(coupon)}</p>
          {conditions(coupon).length > 0 ? <p className="text-sm text-muted-foreground">{conditions(coupon).join(" · ")}</p> : null}
          <p className="text-sm text-muted-foreground">
            {uses}
            {given ? ` · ${given} descontados` : ""}
          </p>
          {coupon.description ? <p className="text-sm text-muted-foreground">{coupon.description}</p> : null}
          {errorText ? (
            <p role="alert" className="text-sm text-danger">
              {errorText}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          loading={save.isPending}
          onClick={() => save.mutate({ couponId: coupon.id, body: { active: !coupon.active } })}
          aria-label={`${coupon.active ? "Pausar" : "Activar"} ${coupon.code}`}
        >
          {coupon.active ? "Pausar" : "Activar"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit} aria-label={`Editar ${coupon.code}`}>
          Editar
        </Button>
        <ConfirmButton
          variant="ghost"
          size="sm"
          confirmLabel="¿Borrarlo?"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(coupon.id)}
          aria-label={`Borrar ${coupon.code}`}
        >
          Borrar
        </ConfirmButton>
      </div>
    </li>
  );
}
