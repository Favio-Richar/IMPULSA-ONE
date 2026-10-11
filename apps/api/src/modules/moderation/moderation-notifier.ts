import { Inject, Injectable } from "@nestjs/common";
import type { EmailAdapter } from "@impulza/auth";
import { MembershipSource, MembershipStatus, type PrismaClient } from "@impulza/database";
import { ABUSE_REPORT_REASON_LABELS, type AbuseReportReason, type ModerationAction } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";

export interface ModerationCaseRef {
  id: string;
  organizationId: string;
  organizationName: string;
  siteName: string;
  reason: AbuseReportReason;
}

const MEASURE_TEXT: Partial<Record<ModerationAction, { subject: string; lead: (site: string) => string }>> = {
  warn: {
    subject: "Aviso sobre tu página",
    lead: (site) => `Recibimos un reporte sobre "${site}" y, tras revisarlo, te enviamos una advertencia. Tu página sigue publicada.`,
  },
  unpublish: {
    subject: "Tu página fue despublicada",
    lead: (site) => `Tras revisar un reporte, despublicamos "${site}". Ya no es visible para el público. No borramos nada: tu contenido sigue intacto en tu panel.`,
  },
  suspend: {
    subject: "Tu organización fue suspendida",
    lead: (site) => `Tras revisar un reporte sobre "${site}", suspendimos tu organización. Tus páginas no se muestran al público y tu panel queda en solo lectura. No borramos nada: puedes ver y exportar tus datos.`,
  },
  restore: {
    subject: "Retiramos la medida sobre tu página",
    lead: (site) => `Retiramos la medida que habíamos aplicado por un reporte sobre "${site}". Tu página vuelve a su estado normal.`,
  },
  uphold: {
    subject: "Revisamos tu apelación",
    lead: (site) => `Revisamos tu apelación sobre "${site}" y mantenemos la medida.`,
  },
};

/**
 * Avisos de moderación por correo (F9.9c, ADR-028 §7). Al propietario le llega SIEMPRE una explicación (la categoría del
 * reporte y lo que escribió el equipo) y cómo apelar; nunca el texto del reporte ni datos de quien denunció.
 *
 * Un aviso que falla no deshace la decisión (ya está guardada y auditada): se registra y se sigue. Quien modera lo ve
 * en el log; el propietario lo ve igual en su panel, donde la medida figura con su explicación.
 */
@Injectable()
export class ModerationNotifier {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
  ) {}

  private casesUrl(): string {
    return `${env.APP_BASE_URL}/configuracion/moderacion`;
  }

  private async owners(organizationId: string): Promise<string[]> {
    const members = await this.prisma.membership.findMany({
      where: { organizationId, status: MembershipStatus.ACTIVE, source: MembershipSource.DIRECT, role: { name: "OWNER" } },
      select: { user: { select: { email: true } } },
    });
    return [...new Set(members.map((member) => member.user.email))];
  }

  private async send(to: string, subject: string, text: string, event: string, caseId: string): Promise<void> {
    try {
      await this.email.send({ to, subject, text });
    } catch (error) {
      logger.error("no se pudo enviar el aviso de moderacion", { event, caseId, error });
    }
  }

  /** Decisión del equipo que cambia la situación del negocio. Descartar un reporte no se avisa: no hubo medida. */
  async decision(ref: ModerationCaseRef, action: ModerationAction, statement: string): Promise<void> {
    const copy = MEASURE_TEXT[action];
    if (!copy) return;
    const recipients = await this.owners(ref.organizationId);
    if (recipients.length === 0) {
      logger.warn("aviso de moderacion sin destinatarios (la organizacion no tiene propietario activo)", { caseId: ref.id });
      return;
    }
    const appealable = action === "warn" || action === "unpublish" || action === "suspend";
    const body = [
      "Hola:",
      "",
      copy.lead(ref.siteName),
      "",
      `Motivo del reporte: ${ABUSE_REPORT_REASON_LABELS[ref.reason]}.`,
      `Explicación del equipo: ${statement}`,
      "",
      appealable
        ? `Si crees que no corresponde, puedes apelar desde tu panel (también con la organización suspendida) y una persona del equipo volverá a revisar el caso: ${this.casesUrl()}`
        : `Puedes ver el detalle en tu panel: ${this.casesUrl()}`,
      "",
      "Equipo de Impulza One",
    ].join("\n");
    await Promise.all(recipients.map((to) => this.send(to, `${copy.subject} — Impulza One`, body, `moderation.${action}`, ref.id)));
  }

  /** Alerta al equipo: hay una apelación esperando decisión. Sin copiar el texto: se lee en la administración. */
  async appealReceived(ref: ModerationCaseRef): Promise<void> {
    if (!env.SUPPORT_NOTIFICATION_EMAIL) {
      logger.warn("SUPPORT_NOTIFICATION_EMAIL no esta configurado: el equipo no recibe aviso de la apelacion", { caseId: ref.id });
      return;
    }
    const url = env.ADMIN_BASE_URL ? `\n\nRevisar: ${env.ADMIN_BASE_URL}/moderacion/${ref.id}` : "";
    await this.send(
      env.SUPPORT_NOTIFICATION_EMAIL,
      `[Moderación] Apelación de ${ref.organizationName}`,
      `Una organización apeló una medida de moderación.\n\nOrganización: ${ref.organizationName}\nSitio: ${ref.siteName}${url}`,
      "moderation.appeal_received",
      ref.id,
    );
  }
}
