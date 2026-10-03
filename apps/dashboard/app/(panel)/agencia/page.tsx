"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { AgencyClientResponse } from "@impulza/contracts";
import { AGENCY_BILLING_MODES, slugSchema, type AgencyClientAction } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { CheckCircle2, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ConfirmButton } from "../../../components/confirm-button";
import { PlanLimitNotice } from "../../../components/plan-limit-notice";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { ApiError } from "../../../lib/api-client";
import { useAgencyClientAction, useAgencyClients, useAgencyStatus, useCreateAgencyClient, useRequestAgencyLink } from "../../../lib/hooks/use-agency";
import { getPlanLimitInfo } from "../../../lib/plan-limit";
import { slugify } from "../../../lib/slugify";

/** Texto de un error de la API: el mensaje del servidor si lo trae, o uno genérico. */
function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string") return body.message;
  }
  return fallback;
}

const STATUS_TEXT: Record<AgencyClientResponse["status"], string> = {
  INVITED: "Invitado",
  ACTIVE: "Activo",
  PAUSED: "En pausa (solo lectura)",
  ARCHIVED: "Archivado",
  TRANSFERRING: "En traspaso",
  ENDED: "Terminado",
};

function statusLabel(client: AgencyClientResponse): string {
  if (client.status === "INVITED") return client.agencyCreated ? "Esperando al propietario" : "Solicitud pendiente del propietario";
  return STATUS_TEXT[client.status];
}

const BILLING_TEXT = { CLIENT_PAYS: "Paga el cliente", AGENCY_PAYS: "Paga la agencia" } as const;

export default function AgenciaPage(): React.JSX.Element {
  const organizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  if (!organizationId) {
    return <EmptyState title="Selecciona una organización" description="Elige una organización arriba para administrar su agencia." />;
  }
  return <AgencyView organizationId={organizationId} />;
}

function AgencyView({ organizationId }: { organizationId: string }): React.JSX.Element {
  const status = useAgencyStatus(organizationId);
  const isAgency = status.data?.kind === "AGENCY";
  const clients = useAgencyClients(organizationId, isAgency);

  if (status.isPending) return <LoadingState label="Cargando la agencia…" />;
  if (status.isError || !status.data) return <ErrorState onRetry={() => void status.refetch()} />;

  if (!isAgency) {
    return (
      <EmptyState
        title="Esta organización no es una agencia"
        description="Para administrar clientes, activa el modo agencia en Configuración › Agencia."
        action={
          <Link href="/configuracion/agencia" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            Ir a Configuración › Agencia
          </Link>
        }
      />
    );
  }

  const { clientsUsed, clientsLimit } = status.data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Agencia</h1>
        <p className="text-sm text-muted-foreground">
          Administra los negocios de tus clientes con acceso delegado: tú trabajas, ellos siguen siendo los dueños y pueden revocarte cuando quieran.
        </p>
        <p className="text-sm text-foreground" data-testid="agency-quota">
          Clientes: <strong>{clientsUsed}</strong> {clientsLimit === null ? "(sin límite)" : `de ${clientsLimit}`}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <NewClientForm organizationId={organizationId} />
        <LinkClientForm organizationId={organizationId} />
      </div>

      <section aria-labelledby="clients-heading" className="flex flex-col gap-3">
        <h2 id="clients-heading" className="text-base font-semibold text-foreground">
          Tus clientes
        </h2>
        {clients.isPending ? (
          <LoadingState label="Cargando clientes…" />
        ) : clients.isError ? (
          <ErrorState onRetry={() => void clients.refetch()} />
        ) : clients.data.length === 0 ? (
          <EmptyState title="Todavía no tienes clientes" description="Da de alta tu primer cliente o pide acceso a un negocio que ya existe." />
        ) : (
          <ul className="grid gap-3" data-testid="agency-clients">
            {clients.data.map((client) => (
              <ClientRow key={client.id} organizationId={organizationId} client={client} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---- alta de un cliente nuevo ------------------------------------------------------------------------------------

const newClientSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres.").max(120, "Máximo 120 caracteres."),
  slug: slugSchema,
  ownerEmail: z.string().trim().email("Escribe un correo válido."),
  billingMode: z.enum(AGENCY_BILLING_MODES),
});
type NewClientValues = z.infer<typeof newClientSchema>;

function NewClientForm({ organizationId }: { organizationId: string }): React.JSX.Element {
  const create = useCreateAgencyClient(organizationId);
  const [done, setDone] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<NewClientValues>({ resolver: zodResolver(newClientSchema), defaultValues: { billingMode: "CLIENT_PAYS" } });

  const nameField = register("name", {
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!slugTouched) setValue("slug", slugify(event.target.value), { shouldValidate: false });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nuevo cliente</CardTitle>
        <CardDescription>
          Creamos el espacio de tu cliente y entras a trabajar de inmediato. Al propietario le llega una invitación por correo (vence en 7 días).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={handleSubmit(async (values) => {
            setDone(null);
            const created = await create.mutateAsync(values).catch(() => null);
            if (created) {
              setDone(`Creamos «${created.clientName}» e invitamos a ${created.ownerInviteEmail ?? "su propietario"}.`);
              reset({ billingMode: "CLIENT_PAYS", name: "", slug: "", ownerEmail: "" });
              setSlugTouched(false);
            }
          })}
        >
          <Input label="Nombre del negocio" {...nameField} error={errors.name?.message} />
          <Input
            label="Identificador (interno)"
            helperText="Minúsculas, números y guiones. No se puede repetir en la plataforma."
            {...register("slug", { onChange: () => setSlugTouched(true) })}
            error={errors.slug?.message}
          />
          <Input label="Correo del propietario" type="email" autoComplete="off" {...register("ownerEmail")} error={errors.ownerEmail?.message} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">Quién paga el plan</span>
            <select
              className="h-10 rounded-md border border-border-strong bg-background px-2 text-sm text-foreground"
              {...register("billingMode")}
            >
              {AGENCY_BILLING_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {BILLING_TEXT[mode]}
                </option>
              ))}
            </select>
          </label>
          <PlanLimitNotice error={create.error} />
          {create.isError && !getPlanLimitInfo(create.error) ? (
            <p role="alert" className="text-sm text-danger">
              {errorText(create.error, "No pudimos crear el cliente. Intenta de nuevo.")}
            </p>
          ) : null}
          {done ? (
            <p role="status" className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" aria-hidden="true" /> {done}
            </p>
          ) : null}
          <Button type="submit" loading={create.isPending} className="self-start">
            Crear cliente
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---- vincular un negocio existente --------------------------------------------------------------------------------

const linkSchema = z.object({
  clientSlug: slugSchema,
  ownerEmail: z.string().trim().email("Escribe un correo válido."),
});
type LinkValues = z.infer<typeof linkSchema>;

function LinkClientForm({ organizationId }: { organizationId: string }): React.JSX.Element {
  const request = useRequestAgencyLink(organizationId);
  const [done, setDone] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LinkValues>({ resolver: zodResolver(linkSchema) });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Vincular un negocio que ya existe</CardTitle>
        <CardDescription>
          Pide acceso con el identificador del negocio y el correo de su propietario. No tendrás acceso hasta que él acepte.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={handleSubmit(async (values) => {
            setDone(null);
            const created = await request.mutateAsync(values).catch(() => null);
            if (created) {
              setDone(`Enviamos la solicitud a ${created.clientName}. Quedó pendiente de su propietario.`);
              reset({ clientSlug: "", ownerEmail: "" });
            }
          })}
        >
          <Input label="Identificador del negocio" {...register("clientSlug")} error={errors.clientSlug?.message} />
          <Input label="Correo de su propietario" type="email" autoComplete="off" {...register("ownerEmail")} error={errors.ownerEmail?.message} />
          <PlanLimitNotice error={request.error} />
          {request.isError && !getPlanLimitInfo(request.error) ? (
            <p role="alert" className="text-sm text-danger">
              {errorText(request.error, "No pudimos enviar la solicitud. Intenta de nuevo.")}
            </p>
          ) : null}
          {done ? (
            <p role="status" className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-4" aria-hidden="true" /> {done}
            </p>
          ) : null}
          <Button type="submit" variant="secondary" loading={request.isPending} className="self-start">
            Pedir acceso
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---- un cliente ----------------------------------------------------------------------------------------------------

function ClientRow({ organizationId, client }: { organizationId: string; client: AgencyClientResponse }): React.JSX.Element {
  const router = useRouter();
  const setActiveOrganizationId = useActiveOrgStore((state) => state.setActiveOrganizationId);
  const act = useAgencyClientAction(organizationId);
  const run = (action: AgencyClientAction, hidePublicSite?: boolean) => act.mutate({ clientId: client.id, action, hidePublicSite });
  // Pausar y archivar piden una confirmación con una elección: ocultar o no el sitio público del cliente mientras dure.
  const [choosing, setChoosing] = useState<"pause" | "archive" | null>(null);
  const [hideSite, setHideSite] = useState(false);
  const startChoosing = (action: "pause" | "archive") => {
    setHideSite(client.publicHidden);
    setChoosing(action);
  };

  // «Entrar» solo donde el servidor da acceso: activo, en pausa (lectura) o recién creado por la agencia.
  const canEnter = client.status === "ACTIVE" || client.status === "PAUSED" || (client.status === "INVITED" && client.agencyCreated);

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between" data-client-slug={client.clientSlug}>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="truncate text-sm font-semibold text-foreground">{client.clientName}</p>
        <p className="truncate text-xs text-muted-foreground">{client.clientSlug}</p>
        <p className="text-sm text-foreground">
          <span data-testid="client-status">{statusLabel(client)}</span>
          <span className="text-muted-foreground"> · {BILLING_TEXT[client.billingMode]}</span>
        </p>
        {client.publicHidden ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground" data-testid="client-public-hidden">
            <EyeOff className="size-3.5 text-warning" aria-hidden="true" /> Sitio público oculto (se muestra de nuevo al reanudar o soltar)
          </p>
        ) : null}
        {client.ownerInviteEmail ? <p className="text-xs text-muted-foreground">Invitación enviada a {client.ownerInviteEmail}</p> : null}
        {act.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorText(act.error, "No pudimos hacer ese cambio.")}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canEnter ? (
          <Button
            size="sm"
            onClick={() => {
              setActiveOrganizationId(client.clientOrganizationId);
              router.push("/");
            }}
          >
            Entrar
          </Button>
        ) : null}
        {client.status === "ACTIVE" ? (
          <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => startChoosing("pause")}>
            Pausar
          </Button>
        ) : null}
        {client.status === "PAUSED" ? (
          <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => run("resume")}>
            Reanudar
          </Button>
        ) : null}
        {client.status === "ACTIVE" || client.status === "PAUSED" || (client.status === "INVITED" && client.agencyCreated) ? (
          <Button size="sm" variant="ghost" loading={act.isPending} onClick={() => startChoosing("archive")}>
            Archivar
          </Button>
        ) : null}
        {client.status === "ARCHIVED" ? (
          <Button size="sm" variant="secondary" loading={act.isPending} onClick={() => run("unarchive")}>
            Desarchivar
          </Button>
        ) : null}
        <ConfirmButton
          size="sm"
          variant="ghost"
          confirmLabel="¿Soltar a este cliente? Perderás el acceso."
          loading={act.isPending}
          onConfirm={() => run("release")}
        >
          Soltar
        </ConfirmButton>
      </div>
      {choosing ? (
        <div className="flex w-full flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:basis-full" role="group" aria-label={choosing === "pause" ? "Confirmar pausa" : "Confirmar archivo"}>
          <p className="text-sm text-foreground">
            {choosing === "pause"
              ? "En pausa, tu equipo puede ver este negocio pero no hacer cambios."
              : "Archivado, tu equipo pierde el acceso a este negocio. Sus datos y sitios no se borran."}
          </p>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" className="mt-0.5 size-4" checked={hideSite} onChange={(event) => setHideSite(event.target.checked)} />
            <span>
              También ocultar su sitio público mientras dure
              <span className="block text-xs text-muted-foreground">
                Sus visitantes verán que el sitio no existe. No se borra nada: se muestra de nuevo al reanudar, desarchivar o soltar, y su propietario lo ve en su panel.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              loading={act.isPending}
              onClick={() => {
                run(choosing, hideSite);
                setChoosing(null);
              }}
            >
              {choosing === "pause" ? "Confirmar pausa" : "Confirmar archivo"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChoosing(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
