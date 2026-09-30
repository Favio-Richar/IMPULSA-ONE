import type { PublicDownloadResponse } from "@impulza/contracts";

const PANEL =
  "rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-surface)] p-5 shadow-[var(--site-shadow)] text-[var(--site-color-foreground)] sm:p-6";
const PRIMARY =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 py-2.5 text-sm font-semibold text-[var(--site-color-primary-foreground)]";
const NOTICE = "rounded-[var(--site-radius)] border border-[var(--site-color-border)] bg-[var(--site-color-background)] px-3 py-2 text-sm";

/** Tamaño legible: "1,2 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

const STATUS_TEXT: Record<Exclude<PublicDownloadResponse["status"], "ready">, string> = {
  awaiting_payment: "Tu pedido todavía no está pagado. Podrás descargar el archivo apenas se confirme el pago; te avisaremos por correo.",
  revoked: "Este pedido fue cancelado o devuelto: el archivo ya no está disponible.",
  limit_reached: "Ya usaste todas las descargas de este pedido. Si necesitas bajarlo de nuevo, contacta al negocio.",
  unavailable: "Este producto ya no tiene un archivo para descargar. Contacta al negocio.",
};

/** Mensajes al volver del botón "Descargar" cuando no se pudo entregar (vienen en `?error=`). */
export const ERROR_TEXT: Record<string, string> = {
  awaiting_payment: STATUS_TEXT.awaiting_payment,
  revoked: STATUS_TEXT.revoked,
  limit_reached: STATUS_TEXT.limit_reached,
  unavailable: STATUS_TEXT.unavailable,
  rate_limited: "Hiciste muchos intentos seguidos. Espera unos minutos y vuelve a intentarlo.",
  invalid: "El enlace de descarga no es válido.",
  upstream: "No pudimos preparar la descarga. Intenta de nuevo en un momento.",
};

/**
 * Descarga del archivo comprado (F5.11b, ADR-015), con el tema del negocio. El botón es un
 * formulario POST: solo el clic cuenta una descarga (no la precarga ni una vista previa del enlace).
 */
export function DownloadPanel({ token, download, error }: { token: string; download: PublicDownloadResponse; error: string | null }) {
  const errorText = error ? (ERROR_TEXT[error] ?? ERROR_TEXT.upstream) : null;
  return (
    <section className={`${PANEL} mx-auto flex max-w-md flex-col gap-4`} aria-labelledby="download-title">
      <p className="text-sm text-[var(--site-color-muted-foreground)]">Tu compra en {download.siteName}</p>
      <h1 id="download-title" className="text-lg font-semibold">
        {download.productName}
      </h1>
      {download.fileName ? (
        <p className="text-sm">
          <span className="font-medium [overflow-wrap:anywhere]">{download.fileName}</span>
          {download.sizeBytes !== null ? <span className="text-[var(--site-color-muted-foreground)]"> · {formatSize(download.sizeBytes)}</span> : null}
        </p>
      ) : null}
      {errorText ? (
        <p role="alert" className={NOTICE}>
          {errorText}
        </p>
      ) : null}
      {download.status === "ready" ? (
        <>
          <form method="post" action={`/pedido/descarga/${encodeURIComponent(token)}/archivo`}>
            <button type="submit" className={PRIMARY}>
              Descargar
            </button>
          </form>
          <p className="text-xs text-[var(--site-color-muted-foreground)]">
            Te quedan {download.downloadsLeft} {download.downloadsLeft === 1 ? "descarga" : "descargas"}. El enlace es personal: no lo compartas.
          </p>
        </>
      ) : !errorText ? (
        <p role="status" className={NOTICE}>
          {STATUS_TEXT[download.status]}
        </p>
      ) : null}
      <a href={`/${download.siteSlug}`} className="text-sm font-medium text-[var(--site-color-foreground)] underline underline-offset-4">
        Volver a {download.siteName}
      </a>
    </section>
  );
}
