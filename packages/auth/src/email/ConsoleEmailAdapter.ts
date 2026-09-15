import type { EmailAdapter, EmailMessage } from "./EmailAdapter.js";

// Implementación de desarrollo: registra el correo como log estructurado en vez de enviarlo de
// verdad. Nunca usar en producción — ahí se reemplaza por un adaptador real (Resend/SES) que
// implemente la misma interfaz, sin tocar la lógica de negocio de auth.
export class ConsoleEmailAdapter implements EmailAdapter {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      JSON.stringify({
        level: "info",
        event: "email.dev_send",
        to: message.to,
        subject: message.subject,
        text: message.text,
      }),
    );
  }
}
