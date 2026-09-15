import type { CookieOptions, Response } from "express";
import { env } from "../../env.js";

export const SESSION_COOKIE_NAME = "impulza_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Secure solo en producción para no romper http://localhost en desarrollo — nunca false
    // en producción (ST §15, no negociable).
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE_NAME, sessionId, { ...cookieOptions(), maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions());
}
