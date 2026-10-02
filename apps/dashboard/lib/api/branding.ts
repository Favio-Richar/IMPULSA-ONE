import type { PublicPlatformBrandingResponse } from "@impulza/contracts";
import { DEFAULT_PLATFORM_BRANDING } from "@impulza/validation";
import { apiFetch } from "../api-client";

/**
 * Obtiene la configuración de marca pública de la plataforma (F9.1, ADR-028 §4).
 * Si la API no responde o hay error de red, devuelve DEFAULT_PLATFORM_BRANDING de forma segura.
 */
export async function getPlatformBranding(): Promise<PublicPlatformBrandingResponse> {
  try {
    return await apiFetch<PublicPlatformBrandingResponse>("/platform/branding");
  } catch {
    return DEFAULT_PLATFORM_BRANDING as PublicPlatformBrandingResponse;
  }
}
