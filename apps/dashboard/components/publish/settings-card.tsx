"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, LoadingState } from "@impulza/ui";
import { useId } from "react";
import { usePublishSettings, useUpdatePublishSettings } from "../../lib/hooks/use-publish";
import { publishErrorMessage } from "./publish-flow";

/**
 * La opción «aprobar antes de publicar» (F9.6c). La ve todo el equipo, pero solo quien tiene `publish.configure` (el propietario)
 * la cambia: el servidor lo comprueba y esta pantalla deshabilita el botón para no ofrecer lo que respondería 403.
 */
export function PublishSettingsCard({ organizationId }: { organizationId: string }): React.JSX.Element {
  const settings = usePublishSettings(organizationId);
  const update = useUpdatePublishSettings(organizationId);
  const descriptionId = useId();

  if (settings.isPending) return <LoadingState label="Cargando la opción de publicación…" />;
  if (settings.isError) return <ErrorState onRetry={() => void settings.refetch()} />;

  const { requireApproval, canConfigure } = settings.data;

  return (
    <Card data-testid="publish-settings-card">
      <CardHeader>
        <CardTitle>Aprobación antes de publicar</CardTitle>
        <CardDescription>
          Con esta opción activa, quien no pueda aprobar pide la publicación y espera a que otra persona con permiso la revise. Solo se
          publica el contenido que se aprobó.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p id={descriptionId} className="text-sm text-foreground">
            Estado: <strong>{requireApproval ? "activada" : "desactivada"}</strong>. {requireApproval ? "Tu equipo pide aprobación para publicar." : "Cualquiera con permiso sobre páginas publica directo."}
          </p>
          <Button
            type="button"
            variant={requireApproval ? "secondary" : "primary"}
            loading={update.isPending}
            disabled={!canConfigure}
            aria-describedby={descriptionId}
            onClick={() => update.mutate(!requireApproval)}
          >
            {requireApproval ? "Desactivar" : "Activar"}
          </Button>
        </div>
        {!canConfigure ? (
          <p className="text-sm text-muted-foreground">Solo el propietario de la organización puede cambiar esta opción.</p>
        ) : null}
        {requireApproval && canConfigure ? (
          <p className="text-sm text-muted-foreground">Si la desactivas, las solicitudes pendientes se cancelan y tu equipo publica directo.</p>
        ) : null}
        {update.isError ? (
          <p role="alert" className="text-sm text-danger">
            {publishErrorMessage(update.error, "No pudimos cambiar la opción. Intenta de nuevo.")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
