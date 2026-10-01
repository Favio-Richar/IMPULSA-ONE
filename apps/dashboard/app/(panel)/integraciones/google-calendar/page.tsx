"use client";

import { Button, ErrorState, LoadingState } from "@impulza/ui";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../../../lib/api-client";
import { connectGoogleCalendar } from "../../../../lib/api/booking";
import { googleCalendarRedirectUri, takeGoogleOAuthContext } from "../../../../lib/google-calendar-oauth";

// Retorno de Google Calendar (F7.9c): Google devuelve aquí al usuario con `code` y `state`. Se cierra
// la conexión con la API (que verifica el `state` firmado) y se vuelve a la pantalla de origen.

type Phase =
  | { kind: "working" }
  | { kind: "done"; returnPath: string }
  | { kind: "error"; message: string; returnPath: string | null };

async function completeConnection(): Promise<Phase> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const context = state ? takeGoogleOAuthContext(state) : null;
  const returnPath = context?.returnPath ?? null;

  if (params.get("error")) {
    return { kind: "error", message: "No autorizaste el acceso a Google Calendar. Puedes intentarlo de nuevo cuando quieras.", returnPath };
  }
  if (!code || !state || !context) {
    return {
      kind: "error",
      message: "Esta autorización venció o no se inició desde el panel. Vuelve a Reservas y pulsa «Conectar con Google Calendar».",
      returnPath,
    };
  }
  try {
    await connectGoogleCalendar(context.organizationId, context.siteId, {
      code,
      state,
      redirectUri: googleCalendarRedirectUri(window.location.origin),
    });
    return { kind: "done", returnPath: context.returnPath };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof ApiError ? error.message : "No se pudo conectar con Google Calendar. Intenta de nuevo.",
      returnPath: context.returnPath,
    };
  }
}

export default function GoogleCalendarCallbackPage(): React.JSX.Element {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "working" });
  // El `code` de Google sirve una sola vez: en desarrollo React monta el efecto dos veces.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void completeConnection().then(setPhase);
  }, []);

  const returnPath = phase.kind === "done" ? phase.returnPath : null;
  useEffect(() => {
    if (!returnPath) return;
    const timer = window.setTimeout(() => router.replace(returnPath), 1500);
    return () => window.clearTimeout(timer);
  }, [returnPath, router]);

  if (phase.kind === "working") {
    return <LoadingState label="Conectando con Google Calendar…" />;
  }

  if (phase.kind === "done") {
    return (
      <div role="status" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-surface p-8 text-center">
        <CheckCircle2 className="size-8 text-success" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-foreground">Google Calendar conectado</h1>
        <p className="text-sm text-muted-foreground">Las reservas confirmadas se crearán en tu calendario. Te llevamos de vuelta…</p>
        <Link href={phase.returnPath} className="text-sm font-medium text-primary hover:underline">
          Volver ahora
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4">
      <ErrorState title="No se pudo conectar Google Calendar" description={phase.message} />
      <Link href={phase.returnPath ?? "/sitios"}>
        <Button variant="secondary" size="sm">
          Volver a Reservas
        </Button>
      </Link>
    </div>
  );
}
