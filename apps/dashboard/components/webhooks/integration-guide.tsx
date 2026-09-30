"use client";

import { cn } from "@impulza/ui";
import { WEBHOOK_API_VERSION, WEBHOOK_EVENT_LABELS, WEBHOOK_EVENT_TYPES, WEBHOOK_SAMPLE_DATA, WEBHOOK_SIGNATURE_SNIPPET, type WebhookEventType } from "@impulza/validation";
import { ShieldCheck, Zap } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "./copy-button";

const TOOLS = [
  {
    id: "zapier",
    name: "Zapier",
    steps: [
      "Crea un Zap y elige el disparador «Webhooks by Zapier» → «Catch Hook».",
      "Copia la URL que te muestra Zapier y créala aquí como destino, con los eventos que quieras.",
      "En el destino, elige un evento en «Enviar un ejemplo de» y presiona Enviar: Zapier recibe un ejemplo con todos los campos.",
      "Vuelve a Zapier, presiona «Test trigger» y arma las acciones (planilla, CRM, correo…) con esos campos.",
    ],
  },
  {
    id: "make",
    name: "Make",
    steps: [
      "Crea un escenario con el módulo «Webhooks» → «Custom webhook» y agrega un webhook nuevo.",
      "Copia la dirección que te da Make y créala aquí como destino.",
      "Con Make «escuchando» (Redetermine data structure), envía un ejemplo del evento desde el destino.",
      "Make aprende la estructura; conecta los módulos siguientes con esos campos.",
    ],
  },
] as const;

/** Guía de conexión (ADR-017 §7): Zapier, Make, forma de cada evento y cómo verificar la firma. */
export function IntegrationGuide(): React.JSX.Element {
  const [tool, setTool] = useState<(typeof TOOLS)[number]["id"]>("zapier");
  const [event, setEvent] = useState<WebhookEventType>("order.paid");
  const current = TOOLS.find((entry) => entry.id === tool)!;
  const sample = JSON.stringify(
    {
      id: "3f1c2b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f",
      type: event,
      apiVersion: WEBHOOK_API_VERSION,
      createdAt: "2026-09-30T14:20:00.000Z",
      organizationId: "…",
      test: false,
      data: WEBHOOK_SAMPLE_DATA[event],
    },
    null,
    2,
  );

  return (
    <section aria-labelledby="guia-integraciones" className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-background p-4 shadow-xs sm:p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Zap className="size-4" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 id="guia-integraciones" className="text-base font-semibold text-foreground">
            Cómo conectarlo
          </h2>
          <p className="text-sm text-muted-foreground">
            Cada vez que pasa algo, enviamos un aviso (POST con JSON) a tu destino. Si no responde, reintentamos 8 veces durante un día.
          </p>
        </div>
      </div>

      <div role="tablist" aria-label="Herramienta" className="flex gap-1 rounded-md border border-border bg-surface p-1 sm:w-fit">
        {TOOLS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`tab-${entry.id}`}
            aria-selected={tool === entry.id}
            aria-controls={`panel-${entry.id}`}
            onClick={() => setTool(entry.id)}
            className={cn(
              "flex-1 rounded-sm px-4 py-1.5 text-sm font-medium transition-colors sm:flex-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
              tool === entry.id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.name}
          </button>
        ))}
      </div>
      <ol id={`panel-${current.id}`} role="tabpanel" aria-labelledby={`tab-${current.id}`} className="flex flex-col gap-2">
        {current.steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm text-foreground">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">
              {index + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>

      <details className="group min-w-0 rounded-md border border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground marker:text-muted-foreground">Qué trae cada evento</summary>
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Evento de ejemplo">
            {WEBHOOK_EVENT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={event === type}
                onClick={() => setEvent(type)}
                className={cn(
                  "rounded-sm border px-2 py-1 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
                  event === type ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-surface",
                )}
              >
                {WEBHOOK_EVENT_LABELS[type].label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            <code className="font-mono">{event}</code> · {WEBHOOK_EVENT_LABELS[event].description} Los envíos de prueba llevan <code className="font-mono">&quot;test&quot;: true</code>.
          </p>
          <pre className="max-h-80 overflow-auto rounded-md bg-surface p-3 font-mono text-xs leading-relaxed text-foreground">{sample}</pre>
        </div>
      </details>

      <details className="group min-w-0 rounded-md border border-border">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground marker:text-muted-foreground">Verificar que el aviso viene de Impulza</summary>
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            <span>
              Cada aviso trae la cabecera <code className="font-mono text-xs">Impulza-Signature: t=…,v1=…</code>: una firma HMAC-SHA256 de{" "}
              <code className="font-mono text-xs">t.cuerpo</code> con tu secreto. Rechaza firmas de más de 5 minutos y descarta los avisos repetidos por su{" "}
              <code className="font-mono text-xs">id</code>.
            </span>
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Node.js</span>
              <CopyButton value={WEBHOOK_SIGNATURE_SNIPPET} label="Copiar código" />
            </div>
            <pre className="max-h-80 overflow-auto rounded-md bg-surface p-3 font-mono text-xs leading-relaxed text-foreground">{WEBHOOK_SIGNATURE_SNIPPET}</pre>
          </div>
        </div>
      </details>
    </section>
  );
}
