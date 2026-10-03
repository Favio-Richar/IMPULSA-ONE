"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AGENCY_BILLING_MODES, DEFAULT_AGENCY_DASHBOARD_DAYS, slugSchema } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AgencySummary, PeriodSelect } from "../../../components/agency/agency-summary";
import { BILLING_TEXT, errorText } from "../../../components/agency/client-row";
import { ClientsTable } from "../../../components/agency/clients-table";
import { PlanLimitNotice } from "../../../components/plan-limit-notice";
import { useActiveOrgStore } from "../../../lib/active-org-store";
import { useAgencyStatus, useCreateAgencyClient, useRequestAgencyLink } from "../../../lib/hooks/use-agency";
import { getPlanLimitInfo } from "../../../lib/plan-limit";
import { slugify } from "../../../lib/slugify";

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
  // El período lo comparten el resumen y la tabla de clientes.
  const [days, setDays] = useState<number>(DEFAULT_AGENCY_DASHBOARD_DAYS);

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Las cifras suman solo a tus clientes activos.</p>
        <PeriodSelect days={days} onChange={setDays} />
      </div>
      <AgencySummary organizationId={organizationId} days={days} />

      <ClientsTable organizationId={organizationId} days={days} />

      <AddClientSection organizationId={organizationId} initiallyOpen={clientsUsed === 0} />
    </div>
  );
}

/**
 * Alta y vinculación. Con clientes, el alta es secundaria: queda plegada para que la tabla sea lo primero; sin clientes, abierta.
 * El estado inicial se fija una vez: si siguiera al número de clientes, crear el primero plegaría el bloque y taparía su propio aviso.
 */
function AddClientSection({ organizationId, initiallyOpen }: { organizationId: string; initiallyOpen: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details className="rounded-lg border border-border" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer select-none rounded-lg px-4 py-3 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        Dar de alta o vincular un cliente
      </summary>
      <div className="grid gap-4 p-4 pt-1 lg:grid-cols-2">
        <NewClientForm organizationId={organizationId} />
        <LinkClientForm organizationId={organizationId} />
      </div>
    </details>
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
