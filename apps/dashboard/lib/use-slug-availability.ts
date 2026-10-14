import type { SlugAvailabilityResponse } from "@impulza/contracts";
import { publicSlugSchema } from "@impulza/validation";
import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";

export type SlugAvailabilityState = { state: "idle" | "checking" | "free" | "taken" };

/**
 * Disponibilidad en vivo de la dirección mientras se escribe (con retraso para no pedir una vez por tecla). Solo informa:
 * la creación del sitio vuelve a validarla en el servidor. Un fallo de red no bloquea nada: queda en `idle`.
 */
export function useSlugAvailability(slug: string): SlugAvailabilityState {
  const [result, setResult] = useState<{ slug: string; state: "free" | "taken" } | null>(null);
  const valid = publicSlugSchema.safeParse(slug).success;

  useEffect(() => {
    if (!valid) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiFetch<SlugAvailabilityResponse>(`/public/site-slugs/${encodeURIComponent(slug)}/availability`, { signal: controller.signal })
        .then((response) => setResult({ slug, state: response.available ? "free" : "taken" }))
        .catch(() => undefined);
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [slug, valid]);

  if (!valid) {
    return { state: "idle" };
  }
  if (result && result.slug === slug) {
    return { state: result.state };
  }
  return { state: "checking" };
}
