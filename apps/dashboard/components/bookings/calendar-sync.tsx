"use client";

import type { BookingSettingsResponse } from "@impulza/contracts";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@impulza/ui";
import { Calendar, Check, Copy, ExternalLink, RefreshCw, Unlink } from "lucide-react";
import { useState } from "react";
import { ConfirmButton } from "../confirm-button";
import {
  useDisconnectGoogleCalendar,
  useGoogleCalendarStatus,
  useRotateSiteCalendarFeed,
} from "../../lib/hooks/use-booking-setup";
import { getGoogleCalendarAuthUrl } from "../../lib/api/booking";
import { googleCalendarRedirectUri, saveGoogleOAuthContext } from "../../lib/google-calendar-oauth";
import { ApiError } from "../../lib/api-client";

interface CalendarSyncProps {
  organizationId: string;
  siteId: string;
  settings: BookingSettingsResponse;
}

/**
 * Suscripción iCal universal y adaptador de Google Calendar (F7.9c).
 */
export function CalendarSync({ organizationId, siteId, settings }: CalendarSyncProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const rotateFeedMutation = useRotateSiteCalendarFeed(organizationId, siteId);
  const googleStatusQuery = useGoogleCalendarStatus(organizationId, siteId);
  const disconnectGoogleMutation = useDisconnectGoogleCalendar(organizationId, siteId);

  const feedUrl = settings.calendarFeedUrl;

  const handleCopyFeed = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback silencioso si el navegador restringe portapapeles
    }
  };

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    setGoogleError(null);
    try {
      const { url } = await getGoogleCalendarAuthUrl(organizationId, siteId, googleCalendarRedirectUri(window.location.origin));
      const state = new URL(url).searchParams.get("state");
      if (state) {
        saveGoogleOAuthContext(state, { organizationId, siteId, returnPath: window.location.pathname });
      }
      window.location.href = url;
    } catch (err) {
      setConnectingGoogle(false);
      setGoogleError(err instanceof ApiError ? err.message : "No se pudo iniciar la conexión con Google Calendar.");
    }
  };

  const googleStatus = googleStatusQuery.data;
  const isGoogleConfigured = googleStatus?.configured ?? false;
  const googleConnection = googleStatus?.connection;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calendar className="size-5 text-primary" aria-hidden="true" />
          <CardTitle>Sincronización con calendarios</CardTitle>
        </div>
        <CardDescription>
          Mantén tus reservas actualizadas en tu calendario personal (Google Calendar, Apple Calendar, Outlook u otros)
          mediante suscripción iCal o conexión directa.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Sección Feed iCal (.ics, RFC 5545) */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-medium text-foreground">Suscripción universal iCal (.ics)</h3>
              <p className="text-xs text-muted-foreground">
                Feed en tiempo real con todas las reservas confirmadas del sitio. Compatible con cualquier aplicación de
                calendario.
              </p>
            </div>
            {feedUrl ? (
              <ConfirmButton
                variant="secondary"
                size="sm"
                confirmLabel="¿Regenerar enlace? Se revocarán suscripciones anteriores."
                loading={rotateFeedMutation.isPending}
                onConfirm={() => rotateFeedMutation.mutate()}
              >
                <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
                Regenerar enlace
              </ConfirmButton>
            ) : null}
          </div>

          {feedUrl ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                readOnly
                value={feedUrl}
                aria-label="URL del feed iCal de reservas"
                className="w-full rounded-md border border-input bg-surface px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button
                variant={copied ? "primary" : "secondary"}
                size="sm"
                onClick={handleCopyFeed}
                className="shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="mr-1.5 size-3.5" aria-hidden="true" />
                    ¡Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 size-3.5" aria-hidden="true" />
                    Copiar enlace
                  </>
                )}
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Guarda la configuración del sitio para habilitar el enlace de suscripción.
            </p>
          )}

          <div className="mt-3 rounded bg-surface/50 p-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">¿Cómo usarlo? </span>
            En <strong>Google Calendar</strong> ve a <em>Otros calendarios → Desde URL</em>. En{" "}
            <strong>Apple Calendar</strong> ve a <em>Archivo → Nueva suscripción a calendario</em>. En{" "}
            <strong>Outlook</strong> elige <em>Agregar calendario → Suscribirse desde la web</em>.
          </div>
        </div>

        {/* Sección Google Calendar */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-medium text-foreground">Google Calendar</h3>
              <p className="text-xs text-muted-foreground">
                Las reservas confirmadas se crean en tu calendario de Google, y se mueven o borran si se reprograman
                o cancelan. Los eventos que crees en Google no se traen a Impulza.
              </p>
            </div>
            {isGoogleConfigured && googleConnection ? (
              <ConfirmButton
                variant="destructive"
                size="sm"
                confirmLabel="¿Desconectar Google Calendar?"
                loading={disconnectGoogleMutation.isPending}
                onConfirm={() => disconnectGoogleMutation.mutate(undefined)}
              >
                <Unlink className="mr-1.5 size-3.5" aria-hidden="true" />
                Desconectar
              </ConfirmButton>
            ) : null}
          </div>

          {!isGoogleConfigured ? (
            <div className="mt-3 rounded-md bg-surface p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Modo desacoplado</p>
              <p className="mt-1">
                La integración directa con la API de Google Calendar no está habilitada en este entorno
                (faltan credenciales OAuth en el servidor). Puedes utilizar la suscripción universal iCal de arriba para
                mantener sincronizado Google Calendar de manera segura y sin interrupciones.
              </p>
            </div>
          ) : googleConnection ? (
            <div className="mt-3 flex items-center justify-between rounded-md bg-surface p-3 text-xs">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">Cuenta conectada:</span>
                <span className="text-muted-foreground">{googleConnection.email ?? "Google Calendar"}</span>
                {googleConnection.lastSyncAt ? (
                  <span className="text-[11px] text-muted-foreground">
                    Última sincronización: {new Date(googleConnection.lastSyncAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              {googleConnection.status === "CONNECTED" ? (
                <span className="inline-flex items-center rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  Conectado
                </span>
              ) : (
                <Button variant="secondary" size="sm" loading={connectingGoogle} onClick={handleConnectGoogle} className="shrink-0">
                  Volver a conectar
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Conecta tu cuenta de Google para crear automáticamente las citas en tu calendario principal.
              </p>
              <Button
                variant="secondary"
                size="sm"
                loading={connectingGoogle}
                onClick={handleConnectGoogle}
                className="shrink-0"
              >
                <ExternalLink className="mr-1.5 size-3.5" aria-hidden="true" />
                Conectar con Google Calendar
              </Button>
            </div>
          )}

          {isGoogleConfigured && googleConnection && googleConnection.status !== "CONNECTED" ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {googleConnection.lastError ?? "La conexión con Google Calendar dejó de funcionar."} Las reservas nuevas no se
              están copiando a tu calendario.
            </p>
          ) : isGoogleConfigured && googleConnection?.lastError ? (
            <p className="mt-2 text-xs text-muted-foreground">Último aviso de Google: {googleConnection.lastError}</p>
          ) : null}

          {googleError ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {googleError}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
