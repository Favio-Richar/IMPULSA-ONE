import type { APIRequestContext } from "@playwright/test";
import { API_BASE_URL } from "./playwright.config.js";

/**
 * Registra una cuenta por la API. El registro tiene un límite de 5 por minuto por IP (a propósito: es seguridad del producto) y
 * varias pruebas seguidas lo pueden alcanzar; en vez de depender de limpiar Redis, se espera lo que pide el servidor y se reintenta.
 */
export async function registerUser(api: APIRequestContext, email: string, password: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await api.post(`${API_BASE_URL}/auth/register`, { data: { email, password } });
    if (response.status() === 201) return;
    if (response.status() !== 429) throw new Error(`POST /auth/register → ${response.status()}: ${await response.text()}`);
    const wait = Number(response.headers()["retry-after"]);
    await new Promise((resolve) => setTimeout(resolve, (Number.isFinite(wait) && wait > 0 ? Math.min(wait, 65) : 20) * 1000));
  }
  throw new Error("POST /auth/register siguió respondiendo 429 tras varios reintentos.");
}
