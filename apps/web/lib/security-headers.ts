// Cabeceras de seguridad de apps/web (ST §15, ADR-016): la página pública de los negocios, el sitio
// comercial y las páginas de pedido, reserva y descarga. Función pura (sin leer `process.env`) para
// poder probarla; `next.config.ts` la llama con el entorno ya validado.

/** Proveedores de medición permitidos (lista cerrada de ADR-016). Solo se usan con consentimiento. */
export const MEASUREMENT_ORIGINS = {
  scripts: ["https://www.googletagmanager.com", "https://connect.facebook.net"],
  connect: ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://www.googletagmanager.com", "https://www.facebook.com"],
  images: ["https://www.facebook.com"],
} as const;

/** Iframes de video: plantillas fijas por proveedor (F2.4), nunca una URL libre. */
export const FRAME_ORIGINS = ["https://www.youtube-nocookie.com", "https://player.vimeo.com"] as const;

export interface SecurityHeaderOptions {
  /** `true` en `next dev`: Next necesita `eval` y su WebSocket de recarga. */
  development: boolean;
  /**
   * `true` si el sitio se sirve por https (`PUBLIC_WEB_BASE_URL`). Solo entonces van HSTS y
   * `upgrade-insecure-requests`: en local (y en las pruebas de navegador, que corren el build de
   * producción sobre http://localhost) romperían los medios servidos por http.
   */
  https: boolean;
  /** Origen público de los medios (R2 en producción; MinIO `http://…` en desarrollo y pruebas). */
  mediaOrigin?: string | null;
  /** Origen del almacenamiento (S3/R2): la descarga pagada (F5.11b) redirige ahí tras un formulario. */
  storageOrigin?: string | null;
}

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** La política CSP, directiva por directiva. */
export function contentSecurityPolicy(options: SecurityHeaderOptions): string {
  const media = originOf(options.mediaOrigin);
  const storage = originOf(options.storageOrigin);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-inline': Next.js hidrata con scripts en línea; un nonce obligaría a renderizar cada
    // página sin caché (ADR-016). Los orígenes externos son solo los dos proveedores de medición.
    "script-src": ["'self'", "'unsafe-inline'", ...(options.development ? ["'unsafe-eval'"] : []), ...MEASUREMENT_ORIGINS.scripts],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Las imágenes las eligen los negocios (cualquier https) o vienen de la biblioteca de medios.
    "img-src": ["'self'", "data:", "blob:", "https:", ...(media ? [media] : [])],
    "media-src": ["'self'", "blob:", "https:", ...(media ? [media] : [])],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...MEASUREMENT_ORIGINS.connect, ...(options.development ? ["ws:", "http://localhost:*"] : [])],
    "frame-src": [...FRAME_ORIGINS],
    "frame-ancestors": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...(storage ? [storage] : [])],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${[...new Set(values)].join(" ")}`);
  if (options.https) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** Todas las cabeceras de seguridad, en el formato de `headers()` de `next.config`. */
export function securityHeaders(options: SecurityHeaderOptions): Array<{ key: string; value: string }> {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    ...(options.https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  ];
}
