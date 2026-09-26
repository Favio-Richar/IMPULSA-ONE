"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { SiteDomainResponse } from "@impulza/contracts";
import { createSiteDomainSchema, DOMAIN_CHECK_ERROR_MESSAGES, MAX_DOMAINS_PER_SITE } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { Check, CheckCircle2, Clock, Copy, XCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../../lib/api-client";
import { useAddSiteDomain, useRemoveSiteDomain, useSiteDomains, useVerifySiteDomain } from "../../lib/hooks/use-domains";
import { ConfirmButton } from "../confirm-button";

type FormValues = z.input<typeof createSiteDomainSchema>;

/** El mensaje que manda el servidor (ya está en español y es específico), o uno por defecto. */
function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string") {
      return body.message;
    }
  }
  return fallback;
}

/**
 * Dominio propio del sitio (F4.7): agregar, ver el registro TXT a crear, verificar y quitar. El
 * servidor normaliza y valida el dominio igual que acá (ST §15); la verificación la hace él.
 */
export function CustomDomains({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const domainsQuery = useSiteDomains(organizationId, siteId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dominio propio</CardTitle>
        <CardDescription>
          Muestra tu página en tu propio dominio (por ejemplo, mi-negocio.cl). Primero demuestras que el dominio es tuyo con
          un registro en tu proveedor de dominio; después lo apuntas a Impulza.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AddDomainForm organizationId={organizationId} siteId={siteId} disabled={(domainsQuery.data?.length ?? 0) >= MAX_DOMAINS_PER_SITE} />
        {domainsQuery.isPending ? (
          <LoadingState label="Cargando dominios…" />
        ) : domainsQuery.isError ? (
          <ErrorState onRetry={() => domainsQuery.refetch()} />
        ) : domainsQuery.data.length === 0 ? (
          <EmptyState title="Sin dominio propio todavía" description="Tu página se sigue viendo en su dirección de Impulza." />
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Dominios del sitio">
            {domainsQuery.data.map((domain) => (
              <DomainItem key={domain.id} organizationId={organizationId} siteId={siteId} domain={domain} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AddDomainForm({ organizationId, siteId, disabled }: { organizationId: string; siteId: string; disabled: boolean }): React.JSX.Element {
  const addMutation = useAddSiteDomain(organizationId, siteId);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(createSiteDomainSchema) });

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      await addMutation.mutateAsync(values.domain);
      reset({ domain: "" });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 422 || error.status === 400)) {
        setError("domain", { message: serverMessage(error, "Revisa el dominio: el servidor lo rechazó.") });
        return;
      }
      if (error instanceof ApiError && error.status === 429) {
        setError("root", { message: "Muchos intentos seguidos. Espera un rato y vuelve a intentarlo." });
        return;
      }
      setError("root", { message: "Ocurrió un error inesperado. Intenta de nuevo." });
    }
  }

  return (
    <form
      className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      aria-label="Agregar dominio propio"
    >
      <Input
        label="Dominio"
        placeholder="mi-negocio.cl"
        autoComplete="off"
        spellCheck={false}
        helperText={errors.domain ? undefined : disabled ? `Un sitio admite hasta ${MAX_DOMAINS_PER_SITE} dominios.` : "Sin https:// ni rutas. Puede ser con o sin www."}
        error={errors.domain?.message}
        disabled={disabled}
        {...register("domain")}
      />
      <Button type="submit" loading={addMutation.isPending} disabled={disabled} className="sm:mt-6">
        Agregar dominio
      </Button>
      {errors.root ? (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {errors.root.message}
        </p>
      ) : null}
    </form>
  );
}

const STATUS: Record<SiteDomainResponse["status"], { label: string; icon: React.ReactNode }> = {
  PENDING: { label: "Pendiente de verificar", icon: <Clock className="size-4 text-warning" aria-hidden="true" /> },
  FAILED: { label: "Sin verificar", icon: <XCircle className="size-4 text-danger" aria-hidden="true" /> },
  VERIFIED: { label: "Verificado", icon: <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> },
};

function DomainItem({ organizationId, siteId, domain }: { organizationId: string; siteId: string; domain: SiteDomainResponse }): React.JSX.Element {
  const verifyMutation = useVerifySiteDomain(organizationId, siteId);
  const removeMutation = useRemoveSiteDomain(organizationId, siteId);
  const status = STATUS[domain.status];
  const verifyError = !verifyMutation.error
    ? null
    : verifyMutation.error instanceof ApiError && verifyMutation.error.status === 429
      ? "Muchos intentos seguidos. Espera unos minutos y vuelve a verificar."
      : serverMessage(verifyMutation.error, "No se pudo verificar ahora. Intenta de nuevo.");

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4" data-domain={domain.domain}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-all font-medium text-foreground">{domain.domain}</p>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {status.icon}
            <span>{status.label}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {domain.status !== "VERIFIED" ? (
            <Button variant="secondary" size="sm" loading={verifyMutation.isPending} onClick={() => verifyMutation.mutate(domain.id)}>
              Verificar ahora
            </Button>
          ) : null}
          <ConfirmButton
            variant="ghost"
            size="sm"
            confirmLabel="¿Quitar el dominio?"
            loading={removeMutation.isPending}
            onConfirm={() => removeMutation.mutate(domain.id)}
          >
            Quitar
          </ConfirmButton>
        </div>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {verifyError ? (
          <p role="alert" className="text-sm text-danger">
            {verifyError}
          </p>
        ) : domain.lastCheckError ? (
          <p className="text-sm text-danger">{DOMAIN_CHECK_ERROR_MESSAGES[domain.lastCheckError]}</p>
        ) : null}
      </div>

      {domain.status === "VERIFIED" ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-foreground">
            Listo: el dominio es tuyo. Ahora, en tu proveedor de dominio, apúntalo a Impulza con este registro:
          </p>
          {domain.cnameTarget ? (
            <DnsRecord type="CNAME" name={domain.domain} value={domain.cnameTarget} />
          ) : (
            <p className="rounded-md border border-border bg-surface p-3 text-muted-foreground">
              El destino del registro CNAME se define cuando la plataforma esté publicada en su dominio definitivo. Te
              avisaremos para completar este paso.
            </p>
          )}
          <p className="text-muted-foreground">
            Certificado de seguridad (https): {domain.sslStatus === "ACTIVE" ? "activo" : "se emite al publicar la plataforma en producción"}.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-foreground">
            Para demostrar que el dominio es tuyo, crea este registro <strong>TXT</strong> en tu proveedor de dominio (NIC
            Chile, GoDaddy, Cloudflare…) y luego toca «Verificar ahora». Los cambios pueden tardar desde minutos hasta 48
            horas.
          </p>
          <DnsRecord type="TXT" name={domain.verification.name} value={domain.verification.value} />
        </div>
      )}
    </li>
  );
}

function DnsRecord({ type, name, value }: { type: string; name: string; value: string }): React.JSX.Element {
  return (
    <dl className="grid grid-cols-1 gap-2 rounded-md border border-border bg-surface p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
      <dt className="text-muted-foreground">Tipo</dt>
      <dd className="font-mono text-foreground">{type}</dd>
      <dt className="text-muted-foreground">Nombre</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 break-all text-foreground">{name}</code>
        <CopyButton value={name} label={`Copiar el nombre del registro ${type}`} />
      </dd>
      <dt className="text-muted-foreground">Valor</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 break-all text-foreground">{value}</code>
        <CopyButton value={value} label={`Copiar el valor del registro ${type}`} />
      </dd>
    </dl>
  );
}

function CopyButton({ value, label }: { value: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Button type="button" variant="ghost" size="sm" onClick={copy} aria-label={copied ? "Copiado" : label} className="shrink-0">
      {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
    </Button>
  );
}
