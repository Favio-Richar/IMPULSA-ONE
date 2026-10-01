// Retorno de Google Calendar (F7.9c). Google exige que la dirección de retorno esté registrada
// exactamente, así que es una sola ruta fija del panel (no una por sitio). Antes de salir hacia Google
// se guarda, ligado al `state`, a qué organización y sitio hay que volver; el servidor vuelve a
// verificar todo con el `state` firmado, así que esto es solo comodidad de navegación.

export const GOOGLE_CALENDAR_CALLBACK_PATH = "/integraciones/google-calendar";

const STORAGE_PREFIX = "impulza:google-calendar-oauth:";

export interface GoogleOAuthContext {
  organizationId: string;
  siteId: string;
  /** Ruta del panel a la que se vuelve al terminar. */
  returnPath: string;
}

export function googleCalendarRedirectUri(origin: string): string {
  return `${origin}${GOOGLE_CALENDAR_CALLBACK_PATH}`;
}

export function saveGoogleOAuthContext(state: string, context: GoogleOAuthContext): void {
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${state}`, JSON.stringify(context));
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): el retorno mostrará que debe iniciarse de nuevo.
  }
}

/** Lee y borra el contexto: cada autorización se cierra una sola vez. */
export function takeGoogleOAuthContext(state: string): GoogleOAuthContext | null {
  try {
    const key = `${STORAGE_PREFIX}${state}`;
    const raw = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GoogleOAuthContext>;
    if (
      typeof parsed.organizationId === "string" &&
      typeof parsed.siteId === "string" &&
      typeof parsed.returnPath === "string" &&
      // Solo rutas internas del panel: nunca un destino externo.
      parsed.returnPath.startsWith("/") &&
      !parsed.returnPath.startsWith("//")
    ) {
      return { organizationId: parsed.organizationId, siteId: parsed.siteId, returnPath: parsed.returnPath };
    }
    return null;
  } catch {
    return null;
  }
}
