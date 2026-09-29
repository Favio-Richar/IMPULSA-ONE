"use client";

import { AB_BUCKET_COOKIE } from "@impulza/validation";
import { useEffect } from "react";

/** 180 días: una prueba suele durar semanas y el visitante debe seguir viendo la misma variante. */
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/**
 * Guarda el grupo A/B con el que el servidor pintó esta página (F6.5, ADR-011), solo cuando la
 * página tiene una prueba en curso y el visitante todavía no tenía grupo. Cookie propia del sitio,
 * con un número de 0 a 99 que comparten cientos de personas: no identifica a nadie (ADR-004). Va
 * antes que `AnalyticsTracker` en el árbol, así la vista de página ya viaja con el grupo.
 */
export function AbBucketCookie({ bucket }: { bucket: number }): null {
  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${AB_BUCKET_COOKIE}=${bucket}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  }, [bucket]);
  return null;
}
