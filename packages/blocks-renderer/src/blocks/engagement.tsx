"use client";

import type { EngagementBlockConfig } from "@impulza/validation";
import { useEffect, useRef, useState } from "react";

// Vistas y «me gusta» de la página (F10). Las cifras las pone el servidor (`/api/engagement/<sitio>/<página>` en
// `apps/web`, que reenvía al visitante real a la API); el bloque nunca decide un número por su cuenta. El «me gusta» es
// optimista —se ve al instante— y se revierte si el servidor no lo acepta.

interface Stats {
  views: number;
  likes: number;
  liked: boolean;
}

const SAMPLE: Stats = { views: 1280, likes: 96, liked: false };
const numberFormat = new Intl.NumberFormat("es-CL");

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0">
      <path
        d="M12 21s-7.5-4.6-9.5-9.2C1 8.3 3 5 6.3 5c2 0 3.2 1.1 3.7 2 .5-.9 1.7-2 3.7-2C17 5 19 8.3 17.5 11.8 15.5 16.4 12 21 12 21Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EngagementBlock({
  config,
  siteSlug,
  pageSlug,
  mode = "public",
}: {
  config: EngagementBlockConfig;
  siteSlug?: string;
  pageSlug?: string;
  mode?: "public" | "preview";
}) {
  const preview = mode === "preview" || !siteSlug || !pageSlug;
  const [stats, setStats] = useState<Stats | null>(preview ? SAMPLE : null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const endpoint = preview ? null : `/api/engagement/${encodeURIComponent(siteSlug!)}/${encodeURIComponent(pageSlug!)}`;

  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    void fetch(endpoint, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Stats>) : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  async function toggle(): Promise<void> {
    if (!stats || busy.current) return;
    busy.current = true;
    const previous = stats;
    const next: Stats = { ...stats, liked: !stats.liked, likes: Math.max(0, stats.likes + (stats.liked ? -1 : 1)) };
    setStats(next);
    setFailed(false);
    if (!endpoint) {
      busy.current = false;
      return;
    }
    setPending(true);
    try {
      const response = await fetch(endpoint, { method: previous.liked ? "DELETE" : "PUT" });
      if (!response.ok) throw new Error("rechazado");
      setStats((await response.json()) as Stats);
    } catch {
      setStats(previous);
      setFailed(true);
    } finally {
      setPending(false);
      busy.current = false;
    }
  }

  // Sin cifras todavía (cargando o sin conexión): no se muestra una fila de ceros engañosa.
  if (!stats) return <div aria-hidden="true" className="h-11" />;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-[var(--site-color-foreground)]" role="group" aria-label="Vistas y me gusta">
      {config.showViews ? (
        <span className="inline-flex min-h-11 items-center gap-2 rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] px-4">
          <EyeIcon />
          <span>
            <strong className="font-semibold">{numberFormat.format(stats.views)}</strong> {stats.views === 1 ? "vista" : "vistas"}
          </span>
        </span>
      ) : null}
      {config.showLikes ? (
        <button
          type="button"
          onClick={() => void toggle()}
          aria-pressed={stats.liked}
          disabled={pending}
          className={`inline-flex min-h-11 items-center gap-2 rounded-[var(--site-radius)] border px-4 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus,var(--site-color-link))] motion-reduce:transition-none ${
            stats.liked
              ? "border-transparent bg-[var(--site-color-primary)] text-[var(--site-color-primary-foreground)]"
              : "border-[var(--site-color-border)] bg-[var(--site-color-surface)] text-[var(--site-color-foreground)]"
          }`}
        >
          <HeartIcon filled={stats.liked} />
          <span>{config.likeLabel}</span>
          <span className="tabular-nums" aria-label={`${stats.likes} ${stats.likes === 1 ? "me gusta" : "me gusta en total"}`}>
            {numberFormat.format(stats.likes)}
          </span>
        </button>
      ) : null}
      {failed ? (
        <p role="alert" className="basis-full text-center text-xs">
          No pudimos guardar tu «me gusta». Intenta de nuevo.
        </p>
      ) : null}
    </div>
  );
}
