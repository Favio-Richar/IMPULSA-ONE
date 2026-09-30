import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { isPublicAddress, safeLookup, UnsafeDestinationError } from "./ssrf.js";

// Envío de un webhook (ADR-017 §1): POST con tiempo máximo, **sin seguir redirecciones** (un 3xx
// cuenta como falla) y leyendo a lo más 4 KB de la respuesta. La conexión pasa por `safeLookup`.

export const WEBHOOK_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4096;

export interface SendResult {
  /** Código HTTP, o `null` si no hubo respuesta (red, DNS, tiempo, destino inseguro). */
  status: number | null;
  ok: boolean;
  durationMs: number;
  /** Motivo técnico, sin datos del cuerpo enviado. */
  error: string | null;
}

export interface SendOptions {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs?: number;
  /**
   * **Solo para pruebas** contra un servidor local: permite `http://` y direcciones privadas. La API
   * y el worker nunca lo activan (ADR-017).
   */
  unsafeAllowPrivateNetwork?: boolean;
}

export function sendWebhook(options: SendOptions): Promise<SendResult> {
  const started = Date.now();
  const finish = (status: number | null, error: string | null): SendResult => ({ status, ok: status !== null && status >= 200 && status < 300, durationMs: Date.now() - started, error });

  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    return Promise.resolve(finish(null, "invalid_url"));
  }
  const secure = url.protocol === "https:";
  if (!secure && !(options.unsafeAllowPrivateNetwork && url.protocol === "http:")) {
    return Promise.resolve(finish(null, "insecure_url"));
  }
  // Una IP literal no pasa por `lookup` (Node conecta directo): se revisa acá, antes de conectar.
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (!options.unsafeAllowPrivateNetwork && isIP(literal) !== 0 && !isPublicAddress(literal)) {
    return Promise.resolve(finish(null, "unsafe_destination"));
  }

  return new Promise<SendResult>((resolve) => {
    let settled = false;
    const done = (result: SendResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const transport = secure ? https : http;
    const request = transport.request(
      url,
      {
        method: "POST",
        headers: { ...options.headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(options.body).toString() },
        timeout: options.timeoutMs ?? WEBHOOK_TIMEOUT_MS,
        // Conexión nueva por envío: la IP validada no se reutiliza para otro host.
        agent: false,
        ...(options.unsafeAllowPrivateNetwork ? {} : { lookup: safeLookup as never }),
      },
      (response) => {
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) response.destroy();
        });
        const status = response.statusCode ?? null;
        const end = () => done(finish(status, status !== null && status >= 300 && status < 400 ? "redirect_not_followed" : status !== null && status >= 400 ? `http_${status}` : null));
        response.on("end", end);
        response.on("close", end);
        response.on("error", end);
      },
    );
    request.on("timeout", () => {
      request.destroy();
      done(finish(null, "timeout"));
    });
    request.on("error", (error) => {
      done(finish(null, error instanceof UnsafeDestinationError ? "unsafe_destination" : ((error as NodeJS.ErrnoException).code ?? "network_error")));
    });
    request.end(options.body);
  });
}
