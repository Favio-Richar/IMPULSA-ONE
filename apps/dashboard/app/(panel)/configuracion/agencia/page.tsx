"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, LoadingState } from "@impulza/ui";
import Link from "next/link";
import { OwnerBillingCard } from "../../../../components/agency/owner-billing-card";
import { OwnerTransferCard } from "../../../../components/agency/owner-transfer-card";
import { ConfirmButton } from "../../../../components/confirm-button";
import { useActiveOrgStore } from "../../../../lib/active-org-store";
import { ApiError } from "../../../../lib/api-client";
import {
  useAcceptAgencyLink,
  useAgencyLink,
  useAgencyStatus,
  useEnableAgency,
  useRejectAgencyLink,
  useRevokeAgencyLink,
} from "../../../../lib/hooks/use-agency";

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string") return body.message;
  }
  return fallback;
}

const dateFormat = new Intl.DateTimeFormat("es-CL", { dateStyle: "long" });

/** Configuración › Agencia: el propietario decide qué agencia entra a su negocio y puede activar el modo agencia. */
export default function ConfiguracionAgenciaPage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para ver su agencia." />;
  }
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Agencia</h1>
        <p className="text-sm text-muted-foreground">
          Una agencia puede trabajar en tu negocio con acceso delegado. Tú sigues siendo el dueño: decides quién entra y puedes revocarlo cuando quieras.
        </p>
      </header>
      <LinkCard organizationId={organizationId} />
      <OwnerTransferCard organizationId={organizationId} />
      <OwnerBillingCard organizationId={organizationId} />
      <ModeCard organizationId={organizationId} />
    </div>
  );
}

// ---- la agencia que administra este negocio ------------------------------------------------------------------------

function LinkCard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const link = useAgencyLink(organizationId);
  const accept = useAcceptAgencyLink(organizationId);
  const reject = useRejectAgencyLink(organizationId);
  const revoke = useRevokeAgencyLink(organizationId);

  return (
    <Card data-testid="agency-link-card">
      <CardHeader>
        <CardTitle className="text-base">Agencia de este negocio</CardTitle>
        <CardDescription>La agencia que tiene, o pidió tener, acceso a este negocio.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {link.isPending ? (
          <LoadingState label="Cargando…" />
        ) : link.isError ? (
          <ErrorState onRetry={() => void link.refetch()} />
        ) : link.data === null ? (
          <p className="text-sm text-muted-foreground">Ninguna agencia tiene acceso a este negocio.</p>
        ) : (
          <>
            <div className="flex flex-col gap-1 text-sm">
              <p className="font-semibold text-foreground">{link.data.agencyName}</p>
              <p className="text-muted-foreground" data-testid="agency-link-status">
                {link.data.awaitingOwnerDecision
                  ? "Pidió acceso a tu negocio. Hasta que aceptes, no puede ver nada."
                  : link.data.status === "PAUSED"
                    ? "Acceso en pausa: solo puede ver."
                    : link.data.status === "ARCHIVED"
                      ? "Archivado por la agencia: sin acceso."
                      : link.data.status === "INVITED"
                        ? "Esta agencia creó tu espacio. Te falta aceptar la invitación del correo para quedar como propietario."
                        : `Tiene acceso delegado${link.data.acceptedAt ? ` desde el ${dateFormat.format(new Date(link.data.acceptedAt))}` : ""}.`}
              </p>
            </div>

            {link.data.delegatedMembers.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">Personas de la agencia con acceso hoy</p>
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {link.data.delegatedMembers.map((member) => (
                    <li key={member.email}>{member.email}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {link.data.publicHidden ? (
              <p role="status" data-testid="agency-hid-site" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                La agencia ocultó tu sitio público mientras el acceso está {link.data.status === "ARCHIVED" ? "archivado" : "en pausa"}. No se borró nada: vuelve a verse cuando
                reanude, cuando te suelte o si revocas su acceso.
              </p>
            ) : null}

            <p className="text-xs text-muted-foreground">
              La agencia nunca ve tu cuenta de cobro ni tu suscripción, no gestiona tu equipo y no puede exportar tus contactos. Cada cosa que hace queda
              registrada a nombre de la persona y de la agencia.
            </p>

            {accept.isError || reject.isError || revoke.isError ? (
              <p role="alert" className="text-sm text-danger">
                {errorText(accept.error ?? reject.error ?? revoke.error, "No pudimos hacer ese cambio. Solo el propietario puede decidir.")}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {link.data.awaitingOwnerDecision ? (
                <>
                  <Button loading={accept.isPending} onClick={() => accept.mutate()}>
                    Aceptar
                  </Button>
                  <ConfirmButton variant="secondary" confirmLabel="¿Rechazar la solicitud?" loading={reject.isPending} onConfirm={() => reject.mutate()}>
                    Rechazar
                  </ConfirmButton>
                </>
              ) : (
                <ConfirmButton
                  variant="secondary"
                  confirmLabel="¿Revocar a la agencia? Pierde el acceso al instante."
                  loading={revoke.isPending}
                  onConfirm={() => revoke.mutate()}
                >
                  Revocar acceso de la agencia
                </ConfirmButton>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- modo agencia ------------------------------------------------------------------------------------------------------

function ModeCard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const status = useAgencyStatus(organizationId);
  const enable = useEnableAgency(organizationId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Modo agencia</CardTitle>
        <CardDescription>Para quien administra los negocios de otras personas.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status.isPending ? (
          <LoadingState label="Cargando…" />
        ) : status.isError || !status.data ? (
          <ErrorState onRetry={() => void status.refetch()} />
        ) : status.data.kind === "AGENCY" ? (
          <>
            <p className="text-sm text-foreground">Esta organización es una agencia.</p>
            <Button asChild className="self-start">
              <Link href="/agencia">Administrar clientes</Link>
            </Button>
          </>
        ) : status.data.isClient ? (
          <p className="text-sm text-muted-foreground">Este negocio es cliente de una agencia, así que no puede ser a la vez una agencia.</p>
        ) : status.data.planIncludesAgency ? (
          <>
            <p className="text-sm text-muted-foreground">
              Tu plan incluye {status.data.clientsLimit === null ? "clientes sin límite" : `hasta ${status.data.clientsLimit} clientes`}. Al activarlo podrás dar de alta clientes y
              trabajar en sus negocios con acceso delegado.
            </p>
            {enable.isError ? (
              <p role="alert" className="text-sm text-danger">
                {errorText(enable.error, "No pudimos activar el modo agencia.")}
              </p>
            ) : null}
            <Button loading={enable.isPending} onClick={() => enable.mutate()} className="self-start">
              Activar modo agencia
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Tu plan actual no incluye el modo agencia.</p>
            <Button asChild variant="secondary" className="self-start">
              <Link href="/plan">Ver planes</Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
