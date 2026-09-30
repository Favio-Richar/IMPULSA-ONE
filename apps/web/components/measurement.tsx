"use client";

import {
  CONSENT_VERSION,
  CONVERSION_EVENT_NAME,
  consentStorageKey,
  parseConsentChoice,
  providerCallsFor,
  type ConsentChoice,
  type ConversionEvent,
} from "@impulza/validation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { disableGa4, disableMetaPixel, loadGa4, loadMetaPixel, sendProviderCalls } from "../lib/measurement-tags";

const BUTTON_BASE =
  "inline-flex min-h-11 flex-1 items-center justify-center rounded-[var(--site-radius)] px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-color-foreground)]";
// Aceptar y rechazar con el mismo peso visual (ADR-016 §2): ninguno empuja al otro.
const CHOICE_BUTTON = `${BUTTON_BASE} border border-[var(--site-color-foreground)] bg-[var(--site-color-background)] text-[var(--site-color-foreground)]`;
const SAVE_BUTTON = `${BUTTON_BASE} bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]`;

/** En el servidor todavía no se sabe la elección: ni aviso ni medición hasta hidratar. */
const SERVER_SNAPSHOT = "\u0000servidor";
const CHANGE_EVENT = "impulza:consent-change";

function readRaw(siteSlug: string): string | null {
  try {
    return window.localStorage.getItem(consentStorageKey(siteSlug));
  } catch {
    // Almacenamiento bloqueado (modo privado estricto): sin elección guardada, no se mide.
    return null;
  }
}

/** `true` si se guardó; si no, la elección vale solo para esta visita (en memoria). */
function saveChoice(siteSlug: string, choice: ConsentChoice): boolean {
  try {
    window.localStorage.setItem(consentStorageKey(siteSlug), JSON.stringify(choice));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** La elección guardada vive en `localStorage`: se lee como almacenamiento externo (también entre pestañas). */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * Medición de terceros de la página pública (F7.1, ADR-016): GA4 y el píxel de Meta **solo** con el
 * consentimiento del visitante. Sin elección no se carga nada; "Preferencias de cookies" al pie la
 * reabre, y retirar el consentimiento deja de medir. Traduce las conversiones que anuncian los
 * bloques y el clic en WhatsApp, sin datos personales. Solo se monta si el sitio tiene medición.
 */
export function Measurement({ siteSlug, siteName, ga4MeasurementId, metaPixelId }: { siteSlug: string; siteName: string; ga4MeasurementId: string | null; metaPixelId: string | null }) {
  const enabled = { ga4: ga4MeasurementId !== null, meta: metaPixelId !== null };
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(siteSlug),
    () => SERVER_SNAPSHOT,
  );
  const hydrated = raw !== SERVER_SNAPSHOT;
  // Si el navegador no deja guardar, la elección de esta visita queda en memoria.
  const [memoryChoice, setMemoryChoice] = useState<ConsentChoice | null>(null);
  // La hora de la visita, fijada al montar: alcanza para saber si la elección guardada venció.
  const [visitAt] = useState(() => Date.now());
  const stored = useMemo(() => (hydrated ? parseConsentChoice(raw, visitAt) : null), [hydrated, raw, visitAt]);
  const choice = stored ?? memoryChoice;
  const [reopened, setReopened] = useState(false);
  const open = hydrated && (reopened || choice === null);
  const [configuring, setConfiguring] = useState(false);
  const [draft, setDraft] = useState({ analytics: false, marketing: false });
  const choiceRef = useRef<ConsentChoice | null>(null);
  const titleId = useId();
  const reopenRef = useRef<HTMLButtonElement>(null);

  // Aplicar la elección: cargar lo consentido, apagar lo retirado.
  useEffect(() => {
    choiceRef.current = choice;
    if (!choice) return;
    if (ga4MeasurementId) {
      if (choice.analytics) loadGa4(ga4MeasurementId);
      else disableGa4(ga4MeasurementId);
    }
    if (metaPixelId) {
      if (choice.marketing) loadMetaPixel(metaPixelId);
      else disableMetaPixel();
    }
  }, [choice, ga4MeasurementId, metaPixelId]);

  // Conversiones de los bloques y clics en WhatsApp: solo lo consentido llega a cada proveedor.
  useEffect(() => {
    const flags = { ga4: ga4MeasurementId !== null, meta: metaPixelId !== null };
    const forward = (event: ConversionEvent) => {
      const current = choiceRef.current;
      if (current) sendProviderCalls(providerCallsFor(event, current, flags));
    };
    const onConversion = (event: Event) => {
      const detail = (event as CustomEvent<ConversionEvent>).detail;
      if (detail && typeof detail === "object" && "kind" in detail) forward(detail);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const block = target?.closest("a[href]")?.closest<HTMLElement>("[data-block-type]");
      if (block?.dataset.blockType === "whatsapp") forward({ kind: "whatsapp_click" });
    };
    window.addEventListener(CONVERSION_EVENT_NAME, onConversion);
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      window.removeEventListener(CONVERSION_EVENT_NAME, onConversion);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, [ga4MeasurementId, metaPixelId]);

  const decide = useCallback(
    (analytics: boolean, marketing: boolean) => {
      const next: ConsentChoice = { version: CONSENT_VERSION, analytics: analytics && enabled.ga4, marketing: marketing && enabled.meta, decidedAt: Date.now() };
      setMemoryChoice(next);
      saveChoice(siteSlug, next);
      setReopened(false);
      setConfiguring(false);
      // El foco vuelve a "Preferencias de cookies": quien usa teclado no queda perdido.
      requestAnimationFrame(() => reopenRef.current?.focus());
    },
    [siteSlug, enabled.ga4, enabled.meta],
  );

  const reopen = () => {
    setDraft({ analytics: choice?.analytics ?? false, marketing: choice?.marketing ?? false });
    setConfiguring(true);
    setReopened(true);
  };

  const uses = [enabled.ga4 ? "Google Analytics (para saber cómo se usa esta página)" : null, enabled.meta ? "el píxel de Meta (para medir los anuncios en Facebook e Instagram)" : null].filter(Boolean);

  return (
    <>
      <div className="mx-auto max-w-5xl px-4 pb-6 pt-2 text-center">
        <button
          ref={reopenRef}
          type="button"
          onClick={reopen}
          className="min-h-11 text-xs text-[var(--site-color-muted-foreground)] underline underline-offset-4 hover:text-[var(--site-color-foreground)]"
        >
          Preferencias de cookies
        </button>
      </div>
      {open ? (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          data-consent-banner
          className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-[var(--site-color-foreground)] shadow-[0_-4px_16px_rgba(0,0,0,0.12)]"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <h2 id={titleId} className="text-sm font-semibold">
              Cookies en {siteName}
            </h2>
            <p className="text-sm">
              Con tu permiso, este sitio usa {uses.join(" y ")}. No se comparte tu nombre, correo ni teléfono. Puedes cambiar tu elección cuando quieras desde
              «Preferencias de cookies».
            </p>
            {configuring ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">Elige qué permites</legend>
                {enabled.ga4 ? (
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--site-color-primary)]"
                      checked={draft.analytics}
                      onChange={(event) => setDraft((current) => ({ ...current, analytics: event.target.checked }))}
                    />
                    <span>
                      <span className="font-medium">Analítica</span> — Google Analytics
                    </span>
                  </label>
                ) : null}
                {enabled.meta ? (
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--site-color-primary)]"
                      checked={draft.marketing}
                      onChange={(event) => setDraft((current) => ({ ...current, marketing: event.target.checked }))}
                    />
                    <span>
                      <span className="font-medium">Publicidad</span> — píxel de Meta
                    </span>
                  </label>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" className={SAVE_BUTTON} onClick={() => decide(draft.analytics, draft.marketing)}>
                    Guardar mi elección
                  </button>
                  <button type="button" className={CHOICE_BUTTON} onClick={() => decide(false, false)}>
                    Rechazar todo
                  </button>
                </div>
              </fieldset>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" className={CHOICE_BUTTON} onClick={() => decide(true, true)}>
                  Aceptar
                </button>
                <button type="button" className={CHOICE_BUTTON} onClick={() => decide(false, false)}>
                  Rechazar
                </button>
                <button
                  type="button"
                  className={CHOICE_BUTTON}
                  onClick={() => {
                    setDraft({ analytics: false, marketing: false });
                    setConfiguring(true);
                  }}
                >
                  Configurar
                </button>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </>
  );
}
