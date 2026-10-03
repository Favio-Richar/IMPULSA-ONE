// Contrato de proveedor de email (ARCHITECTURE.md §5) — el dominio de auth nunca importa un SDK
// de proveedor (Resend/SES) directamente, siempre pasa por esta interfaz. La implementación real
// se agrega en un módulo de infraestructura cuando exista una cuenta de proveedor configurada;
// hasta entonces, ConsoleEmailAdapter permite que todo el flujo de auth funcione end-to-end en
// desarrollo sin bloquear F1.4 por una integración externa pendiente.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Versión HTML opcional (campañas, F5.6). El texto va siempre. */
  html?: string;
  /** Cabeceras extra, p. ej. `List-Unsubscribe` en campañas (RFC 8058). */
  headers?: Record<string, string>;
  /**
   * Remitente deseado (F9.1, marca de la plataforma). `name` siempre se puede mostrar; `email` solo lo
   * usa un adaptador real si su dominio está verificado en el proveedor (ADR-028 §5): si falta o no está
   * verificado, el adaptador usa su remitente propio y conserva `name`.
   */
  from?: { name: string; email?: string | null };
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}
