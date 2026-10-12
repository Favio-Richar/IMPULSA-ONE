"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "impulza-pwa-install-dismissed";
const UPDATE_CHECK_MS = 60 * 60 * 1000;

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // Sin almacenamiento: simplemente volverá a ofrecerse.
  }
}

/**
 * App instalable (F10.5): registra el service worker, avisa cuando hay una versión nueva (y solo la activa si la persona acepta)
 * y, si `showInstall`, ofrece instalar la app. No hace nada fuera de producción ni sin soporte del navegador.
 */
export function PwaClient({
  showInstall = false,
  serviceWorkerUrl = "/sw.js",
  className = "",
}: {
  showInstall?: boolean;
  serviceWorkerUrl?: string;
  /** Clases del contenedor fijo (cada app lo viste con sus propios colores). */
  className?: string;
}) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(true);
  const reloading = useRef(false);
  // Solo se recarga cuando la persona pidió actualizar: la primera instalación también cambia de controlador y NO debe recargar.
  const updateRequested = useRef(false);

  useEffect(() => {
    setInstallDismissed(readDismissed());
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    let timer: number | undefined;

    const onControllerChange = () => {
      // La versión nueva tomó el control: se recarga una sola vez para que la página use sus archivos.
      if (!updateRequested.current || reloading.current) return;
      reloading.current = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register(serviceWorkerUrl, { scope: "/" })
      .then((registration) => {
        if (cancelled) return;
        if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // «installed» con un controlador previo = hay una versión anterior en uso: se ofrece actualizar.
            if (installing.state === "installed" && navigator.serviceWorker.controller) setWaiting(installing);
          });
        });
        timer = window.setInterval(() => void registration.update().catch(() => undefined), UPDATE_CHECK_MS);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [serviceWorkerUrl]);

  useEffect(() => {
    if (!showInstall) return;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [showInstall]);

  const update = useCallback(() => {
    updateRequested.current = true;
    waiting?.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  const install = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => undefined);
    setInstallEvent(null);
  }, [installEvent]);

  const offerInstall = showInstall && installEvent !== null && !installDismissed;
  if (!waiting && !offerInstall) return null;

  return (
    <div role="status" aria-live="polite" className={className}>
      {waiting ? (
        <p className="flex flex-wrap items-center gap-3">
          <span>Hay una versión nueva disponible.</span>
          <button type="button" onClick={update} className="underline underline-offset-2">
            Actualizar
          </button>
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-3">
          <span>Instala la app para abrirla más rápido.</span>
          <button type="button" onClick={() => void install()} className="underline underline-offset-2">
            Instalar
          </button>
          <button
            type="button"
            onClick={() => {
              rememberDismissed();
              setInstallDismissed(true);
            }}
            className="text-sm opacity-80 underline underline-offset-2"
          >
            Ahora no
          </button>
        </p>
      )}
    </div>
  );
}
