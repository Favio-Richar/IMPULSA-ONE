/**
 * Pases de wallet de la tarjeta digital (F10.4, ADR-029). Un proveedor por plataforma, detrás de una interfaz común: lo que
 * cambia entre Google y Apple queda aquí dentro, y sin credenciales el proveedor simplemente dice que no está disponible (la
 * tarjeta y la vCard siguen funcionando).
 */

export interface WalletCardData {
  /** Identificador estable del pase (el del sitio): un mismo sitio siempre produce el mismo pase. */
  serialNumber: string;
  siteName: string;
  fullName: string;
  jobTitle: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  /** Página pública de la tarjeta; es también lo que codifica el QR del pase. */
  cardUrl: string;
}

export type WalletPassResult =
  /** Google: se manda al usuario a una dirección de «Guardar en Google Wallet». */
  | { kind: "redirect"; url: string }
  /** Apple: un archivo `.pkpass` firmado. */
  | { kind: "file"; contentType: string; fileName: string; body: Buffer };

export interface WalletPassProvider {
  readonly id: "google" | "apple";
  /** ¿Hay credenciales para emitir pases? */
  isConfigured(): boolean;
  create(card: WalletCardData): Promise<WalletPassResult>;
}

/** El proveedor no está configurado: la API responde 503 con un mensaje claro. */
export class WalletUnavailableError extends Error {
  constructor(readonly provider: "google" | "apple") {
    super(`El pase de ${provider === "google" ? "Google Wallet" : "Apple Wallet"} no está disponible ahora.`);
  }
}

/** Convierte una clave PEM guardada en una variable de entorno (con `\n` escritos) a su forma real. */
export function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}
