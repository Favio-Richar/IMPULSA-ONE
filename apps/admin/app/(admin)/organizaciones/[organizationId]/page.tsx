"use client";

import type { AdminOrganizationDetailResponse, PlanResponse } from "@impulza/contracts";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ReasonField, reasonError } from "../../../../components/reason-field";
import { PageHeader, Section, StatusBadge, Tag } from "../../../../components/ui-bits";
import { UsageMeter } from "../../../../components/usage-meter";
import { ApiError } from "../../../../lib/api-client";
import { adminApi } from "../../../../lib/api";
import { AUDIT_ACTION_LABELS, PLAN_SOURCE_LABELS, ROLE_LABELS, formatDate, formatDateTime, formatPrice } from "../../../../lib/format";

type Detail = AdminOrganizationDetailResponse;

const USAGE_ROWS: Array<{ key: keyof Detail["usage"]; label: string }> = [
  { key: "sites", label: "Sitios" },
  { key: "forms", label: "Formularios" },
  { key: "contacts", label: "Contactos" },
  { key: "shortLinks", label: "Enlaces cortos" },
  { key: "qrCodes", label: "Códigos QR" },
  { key: "members", label: "Miembros" },
  { key: "storageMb", label: "Almacenamiento (MB)" },
];

const MEMBERSHIP_STATUS: Record<string, string> = { ACTIVE: "Activo", INVITED: "Invitado", SUSPENDED: "Suspendido", REMOVED: "Removido" };

export default function OrganizationDetailPage(): React.JSX.Element {
  const { organizationId } = useParams<{ organizationId: string }>();
  const detailQuery = useQuery({
    queryKey: ["admin", "organization", organizationId],
    queryFn: () => adminApi.organization(organizationId),
    // Cada lectura del detalle queda auditada (ADR-005 §5): no se vuelve a pedir sola al volver a
    // la pestaña. Las acciones de abajo devuelven el detalle nuevo y lo reemplazan en la caché.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (detailQuery.isPending) {
    return <LoadingState label="Cargando la organización…" />;
  }
  if (detailQuery.isError) {
    if (detailQuery.error instanceof ApiError && (detailQuery.error.status === 404 || detailQuery.error.status === 400)) {
      return (
        <EmptyState
          title="No encontramos esa organización"
          description="Puede que el enlace esté mal o que se haya eliminado."
          action={
            <Link href="/organizaciones" className="text-sm font-medium text-primary hover:underline">
              Volver a organizaciones
            </Link>
          }
        />
      );
    }
    return <ErrorState onRetry={() => detailQuery.refetch()} />;
  }

  const org = detailQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/organizaciones" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Organizaciones
      </Link>

      <PageHeader
        title={org.name}
        description={`${org.slug} · alta el ${formatDate(org.createdAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/soporte?organizationId=${org.id}`}>Solicitudes de soporte</Link>
            </Button>
            <StatusBadge status={org.status} />
          </div>
        }
      />

      {org.status === "BLOCKED" ? (
        <div role="status" className="flex gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
          <div className="flex flex-col gap-0.5">
            <p className="font-medium text-foreground">
              Bloqueada{org.blockedAt ? ` desde el ${formatDateTime(org.blockedAt)}` : ""}: su sitio no se sirve y su panel está en solo lectura.
            </p>
            {org.blockedReason ? <p className="text-muted-foreground">Motivo: {org.blockedReason}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section
          title={`Plan ${org.plan.name}`}
          description={`${PLAN_SOURCE_LABELS[org.planSource]} · ${formatPrice(org.plan.priceMonthly, org.plan.currency)}${org.plan.priceMonthly > 0 ? " al mes" : ""}`}
          className="xl:col-span-2"
        >
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {USAGE_ROWS.map((row) => (
              <UsageMeter key={row.key} label={row.label} used={org.usage[row.key]} max={org.plan.limits[row.key]} />
            ))}
          </ul>
        </Section>

        <ChangePlanForm org={org} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Miembros" description="Correo y rol. Sin acceso a su contenido.">
          {org.members.length === 0 ? (
            <EmptyState title="Sin miembros" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Correo</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {org.members.map((member) => (
                  <TableRow key={member.membershipId}>
                    <TableCell className="break-all">{member.email}</TableCell>
                    <TableCell>{ROLE_LABELS[member.role] ?? member.role}</TableCell>
                    <TableCell>{MEMBERSHIP_STATUS[member.status] ?? member.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section title="Sitios" description="Nombre, dirección pública y si se está sirviendo.">
          {org.sites.length === 0 ? (
            <EmptyState title="Todavía no creó sitios" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sitio</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {org.sites.map((site) => (
                  <TableRow key={site.id}>
                    <TableCell>
                      <span className="flex flex-col">
                        <span className="font-medium text-foreground">{site.name}</span>
                        <span className="text-xs text-muted-foreground">/{site.slug}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      {site.status === "ARCHIVED" ? (
                        <Tag>Archivado</Tag>
                      ) : site.live ? (
                        <Tag tone="primary">En línea</Tag>
                      ) : (
                        <Tag>Sin publicar</Tag>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <BlockForm org={org} />
        <OrganizationActivity organizationId={org.id} />
      </div>
    </div>
  );
}

function useApplyDetail(organizationId: string) {
  const queryClient = useQueryClient();
  return (detail: Detail) => {
    queryClient.setQueryData(["admin", "organization", organizationId], detail);
    void queryClient.invalidateQueries({ queryKey: ["admin", "organizations"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };
}

function ChangePlanForm({ org }: { org: Detail }): React.JSX.Element {
  const plansQuery = useQuery({ queryKey: ["admin", "plans"], queryFn: adminApi.plans });
  const applyDetail = useApplyDetail(org.id);
  const [planId, setPlanId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () => adminApi.changePlan(org.id, { planId: planId === "none" ? null : planId, reason: reason.trim() }),
    onSuccess: (detail) => {
      applyDetail(detail);
      setReason("");
      setPlanId("");
      setTouched(false);
      setDone(true);
    },
  });

  const options = [
    ...(plansQuery.data ?? []).map((plan: PlanResponse) => ({
      value: plan.id,
      label: `${plan.name} · ${formatPrice(plan.priceMonthly, plan.currency)}`,
    })),
    { value: "none", label: "Quitar asignación (plan por defecto)" },
  ];
  const error = touched ? reasonError(reason) : undefined;

  return (
    <Section title="Cambiar plan" description="Para pagos por transferencia o acuerdos mientras no hay cobro en línea.">
      {plansQuery.isError ? (
        <ErrorState title="No pudimos cargar los planes" onRetry={() => plansQuery.refetch()} />
      ) : (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            setDone(false);
            if (planId && !reasonError(reason)) {
              mutation.mutate();
            }
          }}
        >
          <Select
            label="Nuevo plan"
            placeholder={plansQuery.isPending ? "Cargando planes…" : "Elige un plan"}
            options={options}
            value={planId}
            disabled={plansQuery.isPending}
            onChange={(event) => setPlanId(event.target.value)}
            error={touched && !planId ? "Elige un plan." : undefined}
          />
          <ReasonField value={reason} onChange={setReason} error={error} />
          {org.planSource === "subscription" ? (
            <p className="text-sm text-warning">Tiene una suscripción vigente: el plan asignado a mano rige recién cuando esta termine.</p>
          ) : null}
          {mutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              {mutation.error instanceof ApiError ? mutation.error.messageOr("No se pudo cambiar el plan.") : "No se pudo cambiar el plan."}
            </p>
          ) : null}
          {done ? (
            <p role="status" className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Plan actualizado: ahora rige {org.plan.name}.
            </p>
          ) : null}
          <Button type="submit" loading={mutation.isPending} className="w-full sm:w-auto sm:self-start">
            Guardar plan
          </Button>
        </form>
      )}
    </Section>
  );
}

function BlockForm({ org }: { org: Detail }): React.JSX.Element {
  const applyDetail = useApplyDetail(org.id);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const isBlocked = org.status === "BLOCKED";

  const mutation = useMutation({
    mutationFn: () => (isBlocked ? adminApi.unblock(org.id, reason.trim()) : adminApi.block(org.id, reason.trim())),
    onSuccess: (detail) => {
      applyDetail(detail);
      setReason("");
      setTouched(false);
    },
  });
  const error = touched ? reasonError(reason) : undefined;

  return (
    <Section
      title={isBlocked ? "Restaurar organización" : "Bloquear organización"}
      description={
        isBlocked
          ? "Vuelve a servir su sitio y habilita su panel de inmediato."
          : "Su sitio, formularios, enlaces y QR dejan de responder (404) y su panel queda en solo lectura. No se borra nada."
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!reasonError(reason)) {
            mutation.mutate();
          }
        }}
      >
        <ReasonField
          label={isBlocked ? "Motivo de la restauración" : "Motivo del bloqueo"}
          helperText={isBlocked ? "Queda registrado en la auditoría con tu nombre." : "La organización lo verá en su panel. Queda registrado en la auditoría."}
          value={reason}
          onChange={setReason}
          error={error}
        />
        {mutation.isError ? (
          <p role="alert" className="text-sm text-danger">
            {mutation.error instanceof ApiError ? mutation.error.messageOr("No se pudo completar la acción.") : "No se pudo completar la acción."}
          </p>
        ) : null}
        <Button
          type="submit"
          variant={isBlocked ? "primary" : "destructive"}
          loading={mutation.isPending}
          className="w-full sm:w-auto sm:self-start"
        >
          {isBlocked ? "Restaurar organización" : "Bloquear organización"}
        </Button>
      </form>
    </Section>
  );
}

function OrganizationActivity({ organizationId }: { organizationId: string }): React.JSX.Element {
  const params = { scope: "admin" as const, organizationId, page: 1, pageSize: 10 };
  const auditQuery = useQuery({ queryKey: ["admin", "audit", params], queryFn: () => adminApi.audit(params) });

  return (
    <Section
      title="Actividad de administración"
      description="Últimas acciones del equipo sobre esta organización. Abrir este detalle también queda registrado."
      actions={
        <Link href={`/auditoria?organizationId=${organizationId}`} className="text-sm font-medium text-primary hover:underline">
          Ver todo
        </Link>
      }
    >
      {auditQuery.isPending ? (
        <LoadingState label="Cargando actividad…" />
      ) : auditQuery.isError ? (
        <ErrorState onRetry={() => auditQuery.refetch()} />
      ) : auditQuery.data.items.length === 0 ? (
        <EmptyState title="Sin actividad todavía" />
      ) : (
        <ol className="flex flex-col divide-y divide-border">
          {auditQuery.data.items.map((entry) => {
            const reason = typeof entry.metadata?.reason === "string" ? entry.metadata.reason : null;
            return (
              <li key={entry.id} className="flex flex-col gap-0.5 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">{AUDIT_ACTION_LABELS[entry.action] ?? entry.action}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {entry.actorEmail ?? "Sistema"}
                  {reason ? <> · “{reason}”</> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
