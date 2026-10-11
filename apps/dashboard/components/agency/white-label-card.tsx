"use client";

import type { AgencyClientResponse } from "@impulza/contracts";
import { AA_NORMAL_TEXT, contrastRatio, type UpdateWhiteLabelDto } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, Input, LoadingState, Textarea } from "@impulza/ui";
import type { WhiteLabelSettingsResponse } from "@impulza/contracts";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useAgencyClients } from "../../lib/hooks/use-agency";
import { useSetClientWhiteLabel, useUpdateWhiteLabel, useUploadWhiteLabelAsset, useWhiteLabel } from "../../lib/hooks/use-white-label";

type Target = "logo_light" | "logo_dark" | "favicon";
interface Form {
  displayName: string;
  logoLightUrl: string;
  logoDarkUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string;
  footerText: string;
}

function serverMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

function contrastOk(color: string): boolean | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  return contrastRatio(color, "#ffffff") >= AA_NORMAL_TEXT;
}

function toForm(data: WhiteLabelSettingsResponse): Form {
  return {
    displayName: data.displayName ?? "",
    logoLightUrl: data.logoLightUrl ?? "",
    logoDarkUrl: data.logoDarkUrl ?? "",
    faviconUrl: data.faviconUrl ?? "",
    primaryColor: data.primaryColor ?? "",
    secondaryColor: data.secondaryColor ?? "",
    supportEmail: data.supportEmail ?? "",
    footerText: data.footerText ?? "",
  };
}

/** Marca blanca de la agencia (F9.7a): lo que ve el equipo de los clientes que la tienen activada, y en cuáles clientes se activa. */
export function WhiteLabelCard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const settings = useWhiteLabel(organizationId);
  if (settings.isPending) return <LoadingState label="Cargando tu marca…" />;
  if (settings.isError) {
    return settings.error instanceof ApiError && settings.error.status === 403 ? (
      <EmptyState title="No disponible" description="Esta organización no es una agencia o no tienes permiso para gestionar su marca." />
    ) : (
      <ErrorState onRetry={() => void settings.refetch()} />
    );
  }
  // El formulario nace con lo guardado (sin copiar el estado del servidor dentro de un efecto).
  return <WhiteLabelEditor organizationId={organizationId} initial={settings.data} />;
}

function WhiteLabelEditor({ organizationId, initial }: { organizationId: string; initial: WhiteLabelSettingsResponse }): React.JSX.Element {
  const settings = useWhiteLabel(organizationId);
  const clients = useAgencyClients(organizationId, true);
  const update = useUpdateWhiteLabel(organizationId);
  const upload = useUploadWhiteLabelAsset(organizationId);
  const toggle = useSetClientWhiteLabel(organizationId);
  const [form, setForm] = useState<Form>(() => toForm(initial));
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (key: keyof Form, value: string) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const primaryOk = contrastOk(form.primaryColor);
  const secondaryOk = contrastOk(form.secondaryColor);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>, target: Target) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("lectura"));
        reader.readAsDataURL(file);
      });
      const result = await upload.mutateAsync({
        target,
        fileName: file.name,
        contentType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml",
        sizeBytes: file.size,
        base64Data,
      });
      set(target === "logo_light" ? "logoLightUrl" : target === "logo_dark" ? "logoDarkUrl" : "faviconUrl", result.url);
    } catch (error) {
      setUploadError(serverMessage(error, "No se pudo subir la imagen. Verifica que sea PNG, JPG, WebP o SVG válido."));
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body: UpdateWhiteLabelDto = {
      displayName: form.displayName.trim() || null,
      logoLightUrl: form.logoLightUrl || null,
      logoDarkUrl: form.logoDarkUrl || null,
      faviconUrl: form.faviconUrl || null,
      primaryColor: form.primaryColor.trim() || null,
      secondaryColor: form.secondaryColor.trim() || null,
      supportEmail: form.supportEmail.trim() || null,
      footerText: form.footerText.trim() || null,
    };
    update.mutate(body, { onSuccess: () => setSaved(true) });
  };

  const eligible: AgencyClientResponse[] = (clients.data ?? []).filter(
    (client) => client.status === "ACTIVE" || (client.status === "INVITED" && client.agencyCreated),
  );
  const configured = Boolean((settings.data ?? initial).displayName);

  return (
    <div className="flex flex-col gap-6">
      <Card data-testid="white-label-form">
        <CardHeader>
          <CardTitle>Tu marca</CardTitle>
          <CardDescription>
            Lo que verá el equipo de tus clientes en su panel, en lugar de la marca de la plataforma, en los clientes donde la actives.
            El público de cada negocio sigue viendo la marca del negocio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Input label="Nombre de tu marca" value={form.displayName} maxLength={100} onChange={(event) => set("displayName", event.target.value)} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {(
                [
                  ["Logo para fondo claro", "logo_light", "logoLightUrl"],
                  ["Logo para fondo oscuro", "logo_dark", "logoDarkUrl"],
                  ["Favicon", "favicon", "faviconUrl"],
                ] as const
              ).map(([label, target, field]) => (
                <div key={target} className="flex flex-col gap-2">
                  <label htmlFor={`wl-${target}`} className="text-sm font-medium text-foreground">
                    {label}
                  </label>
                  {form[field] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form[field]} alt={label} className="h-12 max-w-full rounded-md border border-border object-contain p-1" />
                  ) : (
                    <span className="text-xs text-muted-foreground">Sin archivo</span>
                  )}
                  <input id={`wl-${target}`} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => void onFile(event, target)} className="text-xs" />
                  {form[field] ? (
                    <button type="button" className="self-start text-xs text-primary underline underline-offset-2" onClick={() => set(field, "")}>
                      Quitar
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {uploadError ? (
              <p role="alert" className="text-sm text-danger">
                {uploadError}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Color principal"
                value={form.primaryColor}
                placeholder="#0f6f6b"
                onChange={(event) => set("primaryColor", event.target.value)}
                error={primaryOk === false ? `Contraste insuficiente: WCAG 2.2 AA pide ${AA_NORMAL_TEXT}:1 sobre blanco.` : undefined}
              />
              <Input
                label="Color secundario"
                value={form.secondaryColor}
                placeholder="#0b5450"
                onChange={(event) => set("secondaryColor", event.target.value)}
                error={secondaryOk === false ? `Contraste insuficiente: WCAG 2.2 AA pide ${AA_NORMAL_TEXT}:1 sobre blanco.` : undefined}
              />
            </div>
            <Input label="Correo de soporte" type="email" value={form.supportEmail} onChange={(event) => set("supportEmail", event.target.value)} />
            <Textarea
              label="Texto del pie"
              helperText="Aparece al pie del panel de tus clientes (máx. 200 caracteres)."
              maxLength={200}
              rows={2}
              value={form.footerText}
              onChange={(event) => set("footerText", event.target.value)}
            />

            <div className="flex items-center gap-3 rounded-md border border-border bg-surface p-3" data-testid="white-label-preview" aria-label="Vista previa">
              {form.logoLightUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logoLightUrl} alt="" className="h-8 max-w-[120px] object-contain" />
              ) : null}
              <span className="text-sm font-semibold" style={{ color: primaryOk ? form.primaryColor : undefined }}>
                {form.displayName || "Tu marca"}
              </span>
              <span className="text-xs text-muted-foreground">Vista previa del panel de tus clientes</span>
            </div>

            {update.isError ? (
              <p role="alert" className="text-sm text-danger" data-testid="white-label-error">
                {serverMessage(update.error, "No pudimos guardar tu marca. Intenta de nuevo.")}
              </p>
            ) : null}
            {saved ? (
              <p role="status" className="text-sm text-success">
                Marca guardada.
              </p>
            ) : null}
            <Button type="submit" loading={update.isPending} className="self-start" disabled={primaryOk === false || secondaryOk === false}>
              Guardar marca
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card data-testid="white-label-clients">
        <CardHeader>
          <CardTitle>Clientes con tu marca</CardTitle>
          <CardDescription>
            Actívala cliente por cliente. Si la relación termina o se pausa, el panel de ese cliente vuelve solo a la marca de la plataforma.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!configured ? <p className="text-sm text-muted-foreground">Configura y guarda el nombre de tu marca para poder activarla en tus clientes.</p> : null}
          {clients.isPending ? (
            <LoadingState label="Cargando tus clientes…" />
          ) : clients.isError ? (
            <ErrorState onRetry={() => void clients.refetch()} />
          ) : eligible.length === 0 ? (
            <EmptyState title="Aún no tienes clientes activos" description="Cuando des de alta o vincules un cliente, podrás activar tu marca aquí." />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {eligible.map((client) => (
                <li key={client.id} className="flex items-center justify-between gap-3 py-3" data-testid="white-label-client" data-client-name={client.clientName}>
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{client.clientName}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant={client.whiteLabelEnabled ? "secondary" : "primary"}
                    disabled={!configured && !client.whiteLabelEnabled}
                    loading={toggle.isPending && toggle.variables?.relationId === client.id}
                    onClick={() => toggle.mutate({ relationId: client.id, enabled: !client.whiteLabelEnabled })}
                  >
                    {client.whiteLabelEnabled ? "Desactivar" : "Activar"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {toggle.isError ? (
            <p role="alert" className="text-sm text-danger">
              {serverMessage(toggle.error, "No pudimos cambiar la marca de ese cliente.")}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
