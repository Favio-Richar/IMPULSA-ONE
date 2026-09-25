import { Inject, Injectable } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

interface TicketRef {
  id: string;
  subject: string;
  organizationName: string;
}

/**
 * Avisos por correo de soporte (F4.5), por el adaptador de email existente. El correo lleva el
 * asunto y un enlace, **nunca** el detalle: lo que el cliente escribió se lee en el panel, detrás
 * de su sesión, no en una bandeja de correo reenviable.
 *
 * Un aviso que falla no deshace la solicitud ni la respuesta (ya están guardadas): se registra y
 * se sigue, igual que la invalidación de caché de `apps/web`.
 */
@Injectable()
export class SupportNotifier {
  constructor(@Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter) {}

  private customerUrl(ticketId: string): string {
    return `${env.APP_BASE_URL}/soporte/${ticketId}`;
  }

  private staffUrl(ticketId: string): string | null {
    return env.ADMIN_BASE_URL ? `${env.ADMIN_BASE_URL}/soporte/${ticketId}` : null;
  }

  private async send(to: string, subject: string, text: string, event: string, ticketId: string): Promise<void> {
    try {
      await this.email.send({ to, subject, text });
    } catch (error) {
      logger.error("no se pudo enviar el aviso de soporte", { event, ticketId, error });
    }
  }

  private async notifyStaff(ticket: TicketRef, subject: string, lead: string, event: string): Promise<void> {
    if (!env.SUPPORT_NOTIFICATION_EMAIL) {
      logger.warn("SUPPORT_NOTIFICATION_EMAIL no está configurado: el equipo no recibe aviso por correo", { event, ticketId: ticket.id });
      return;
    }
    const url = this.staffUrl(ticket.id);
    await this.send(
      env.SUPPORT_NOTIFICATION_EMAIL,
      subject,
      `${lead}\n\nOrganización: ${ticket.organizationName}\nAsunto: ${ticket.subject}${url ? `\n\nResponder: ${url}` : ""}`,
      event,
      ticket.id,
    );
  }

  async ticketOpened(ticket: TicketRef, openerEmail: string): Promise<void> {
    await Promise.all([
      this.send(
        openerEmail,
        `Recibimos tu solicitud: ${ticket.subject}`,
        `Hola:\n\nRecibimos tu solicitud de soporte "${ticket.subject}". Te responderemos en tu panel y te avisaremos por este medio.\n\nVer la solicitud: ${this.customerUrl(ticket.id)}\n\nEquipo de Impulza One`,
        "support.ticket_opened",
        ticket.id,
      ),
      this.notifyStaff(ticket, `[Soporte] Nueva solicitud: ${ticket.subject}`, "Llegó una solicitud de soporte nueva.", "support.ticket_opened"),
    ]);
  }

  async customerReplied(ticket: TicketRef): Promise<void> {
    await this.notifyStaff(ticket, `[Soporte] Respuesta del cliente: ${ticket.subject}`, "El cliente respondió en una solicitud.", "support.customer_replied");
  }

  async staffReplied(ticket: TicketRef, openerEmail: string | null): Promise<void> {
    if (!openerEmail) {
      return; // la cuenta que la abrió ya no existe: la respuesta queda en el panel de la organización.
    }
    await this.send(
      openerEmail,
      `Respondimos tu solicitud: ${ticket.subject}`,
      `Hola:\n\nEl equipo de Impulza One respondió tu solicitud "${ticket.subject}".\n\nLeer la respuesta: ${this.customerUrl(ticket.id)}\n\nEquipo de Impulza One`,
      "support.staff_replied",
      ticket.id,
    );
  }
}
