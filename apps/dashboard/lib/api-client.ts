import { env } from "./env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

/**
 * Todo fetch pasa por acá: siempre credentials "include" (la sesión vive en cookie HttpOnly) y
 * siempre la cabecera CSRF en métodos mutantes (el backend la exige — ver
 * apps/api/src/common/csrf.guard.ts). Nunca llamar a `fetch` directo desde un componente.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const isMutation = !SAFE_METHODS.has(method);

  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...options,
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(isMutation ? { "X-Requested-With": "impulza-one" } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorBody: unknown = await response.json().catch(() => undefined);
    throw new ApiError(response.status, errorBody);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Como `apiFetch`, pero devuelve el cuerpo como **texto** (un CSV que se descarga). Mismas reglas: sesión por cookie, y un error de la
 * API sale como `ApiError` con su cuerpo.
 */
export async function apiFetchText(path: string): Promise<string> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, { method: "GET", credentials: "include", headers: { Accept: "text/csv" } });
  if (!response.ok) {
    const errorBody: unknown = await response.json().catch(() => undefined);
    throw new ApiError(response.status, errorBody);
  }
  // `response.text()` descarta el BOM del principio (así lo manda la especificación de `fetch`), y sin él Excel mostraría mal las tildes
  // del CSV que se descarga: se decodifican los bytes conservándolo.
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer());
}
