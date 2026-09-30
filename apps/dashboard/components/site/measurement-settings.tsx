"use client";

import type { SiteMeasurementResponse } from "@impulza/contracts";
import { measurementSettingsSchema } from "@impulza/validation";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Input, LoadingState } from "@impulza/ui";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { useSetSiteMeasurement, useSiteMeasurement } from "../../lib/hooks/use-sites";

function Status({ on }: { on: boolean }): React.JSX.Element {
  return on ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-foreground">
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      Activo
    </span>
  ) : (
    <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted-foreground">Apagado</span>
  );
}

/**
 * Medición con Google Analytics 4 y el píxel de Meta (F7.1, ADR-016): solo los identificadores, con
 * las mismas reglas que el servidor. La página pública los usa únicamente con el consentimiento de
 * cada visitante, y eso se explica acá antes de guardar.
 */
export function MeasurementSettings({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const query = useSiteMeasurement(organizationId, siteId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Medición: Google Analytics y píxel de Meta</CardTitle>
        <CardDescription>
          Mide las visitas y las conversiones de tu página (formularios, reservas, pedidos y clics en WhatsApp) en tus propias cuentas de Google Analytics y
          Meta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <LoadingState label="Cargando medición…" />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : (
          <MeasurementForm key={`${query.data.ga4MeasurementId}-${query.data.metaPixelId}`} organizationId={organizationId} siteId={siteId} current={query.data} />
        )}
      </CardContent>
    </Card>
  );
}

function MeasurementForm({ organizationId, siteId, current }: { organizationId: string; siteId: string; current: SiteMeasurementResponse }): React.JSX.Element {
  const save = useSetSiteMeasurement(organizationId, siteId);
  const [ga4, setGa4] = useState(current.ga4MeasurementId ?? "");
  const [pixel, setPixel] = useState(current.metaPixelId ?? "");
  const [errors, setErrors] = useState<{ ga4?: string; pixel?: string; form?: string }>({});
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaved(false);
    const parsed = measurementSettingsSchema.safeParse({ ga4MeasurementId: ga4.trim() === "" ? null : ga4, metaPixelId: pixel.trim() === "" ? null : pixel });
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "ga4MeasurementId") next.ga4 = issue.message;
        if (issue.path[0] === "metaPixelId") next.pixel = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      const stored = await save.mutateAsync(parsed.data);
      // Se muestra lo que quedó guardado (normalizado por el servidor), no lo que se escribió.
      setGa4(stored.ga4MeasurementId ?? "");
      setPixel(stored.metaPixelId ?? "");
      setSaved(true);
    } catch (error) {
      setErrors({
        form:
          error instanceof ApiError && error.status === 403
            ? "Tu rol no permite cambiar la configuración del sitio."
            : "No se pudo guardar. Revisa los datos e intenta de nuevo.",
      });
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Medición del sitio" className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">Google Analytics 4</span>
            <Status on={current.ga4MeasurementId !== null} />
          </div>
          <Input
            label="ID de medición"
            placeholder="G-AB12CD34EF"
            autoComplete="off"
            spellCheck={false}
            value={ga4}
            onChange={(event) => {
              setGa4(event.target.value);
              setSaved(false);
            }}
            error={errors.ga4}
            helperText="En Google Analytics: Administrar → Flujos de datos → tu sitio → «ID de medición». Déjalo vacío para apagarlo."
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">Píxel de Meta</span>
            <Status on={current.metaPixelId !== null} />
          </div>
          <Input
            label="ID del píxel"
            placeholder="1234567890123456"
            inputMode="numeric"
            autoComplete="off"
            value={pixel}
            onChange={(event) => {
              setPixel(event.target.value);
              setSaved(false);
            }}
            error={errors.pixel}
            helperText="En el Administrador de eventos de Meta: Orígenes de datos → tu píxel → «Identificador». Solo los números."
          />
        </div>
      </div>
      <p className="flex items-start gap-2 rounded-md border border-border bg-surface p-3 text-sm text-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>
          Tus visitantes verán un aviso para aceptar o rechazar estas cookies, como exige la ley. Nada se mide antes de que acepten, y nunca se envía su
          nombre, correo ni teléfono. Solo se guarda el identificador: Impulza carga el código oficial de cada servicio.
        </span>
      </p>
      {errors.form ? (
        <p role="alert" className="text-sm text-danger">
          {errors.form}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-foreground">
          Guardado. Tu página ya lo usa.
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={save.isPending}>
          Guardar medición
        </Button>
      </div>
    </form>
  );
}
