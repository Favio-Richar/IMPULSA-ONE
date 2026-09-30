import { env } from "./env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API error ${status}`);
  }

  /** Mensaje legible del servidor (`message`), o `fallback` si no vino uno. */
  messageOr(fallback: string): string {
    const message = (this.body as { message?: unknown } | undefined)?.message;
    return typeof message === "string" ? message : fallback;
  }

  /** Errores de validación campo a campo (`issues`), para mostrarlos junto al campo. */
  get issues(): Array<{ path: string; message: string }> {
    const issues = (this.body as { issues?: unknown } | undefined)?.issues;
    return Array.isArray(issues) ? (issues as Array<{ path: string; message: string }>) : [];
  }
}

/**
 * Todo fetch de la administración pasa por acá: `credentials: "include"` (la sesión es la cookie
 * `HttpOnly` `impulza_admin_session`, que el navegador solo manda a `/api/v1/admin`) y la cabecera
 * anti-CSRF en toda escritura. Nunca llamar a `fetch` directo desde un componente.
 */
export async function apiFetch<T>(path: string, options: Omit<RequestInit, "body"> & { body?: unknown } = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...options,
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(SAFE_METHODS.has(method) ? {} : { "X-Requested-With": "impulza-one" }),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new ApiError(response.status, await response.json().catch(() => undefined));
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Descarga un archivo (CSV) de la API con la misma sesión, y lo entrega al navegador con `nombre`. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, { credentials: "include" });
  if (!response.ok) {
    throw new ApiError(response.status, await response.json().catch(() => undefined));
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
