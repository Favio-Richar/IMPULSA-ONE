import type { CookieOptions, Response } from "express";
import { env } from "../../env.js";

// Sesión de superadministración (ADR-005 §4): cookie propia, distinta de `impulza_session`, que el
// navegador solo envía a `/api/v1/admin` — nunca viaja a las rutas de organización.
export const ADMIN_SESSION_COOKIE_NAME = "impulza_admin_session";
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas, sin renovación
export const ADMIN_COOKIE_PATH = "/api/v1/admin";

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    // Strict y no Lax como el panel: nadie llega a la administración siguiendo un enlace externo.
    sameSite: "strict",
    path: ADMIN_COOKIE_PATH,
  };
}

export function setAdminSessionCookie(res: Response, sessionId: string): void {
  res.cookie(ADMIN_SESSION_COOKIE_NAME, sessionId, { ...cookieOptions(), maxAge: ADMIN_SESSION_TTL_MS });
}

export function clearAdminSessionCookie(res: Response): void {
  res.clearCookie(ADMIN_SESSION_COOKIE_NAME, cookieOptions());
}
