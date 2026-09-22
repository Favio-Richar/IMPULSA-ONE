import { Inject, Injectable } from "@nestjs/common";
import type { Contact, PrismaClient } from "@impulza/database";
import { PRISMA } from "../../database/prisma.module.js";

export interface ContactFromSubmissionInput {
  organizationId: string;
  name?: string;
  email?: string;
  phone?: string;
  /** `form:<formId>` — de dónde salió el consentimiento, para la auditoría de ADR-004 punto 3. */
  consentSource: string;
  consentTextVersion?: string;
}

/**
 * Núcleo compartido del mini-CRM (F3.3): por ahora solo lo que F3.2 necesita para no duplicar la
 * lógica de "quién es este visitante" cuando el mini-CRM completo (lista, filtros, notas, import/
 * export, borrado en cascada auditado) se construya encima de la misma tabla.
 */
@Injectable()
export class ContactsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Solo se llama cuando ya hubo consentimiento explícito (ADR-004 punto 3) — quien decide *si*
   * corresponde llamar a esto es el que conoce el formulario (`FormsService`), no este servicio.
   * Matchea por email dentro de la organización (único criterio confiable, F3.1); sin email no hay
   * forma de deduplicar, así que siempre crea un contacto nuevo.
   */
  async findOrCreateFromSubmission(input: ContactFromSubmissionInput): Promise<Contact> {
    const now = new Date();

    if (input.email) {
      const existing = await this.prisma.contact.findFirst({
        where: { organizationId: input.organizationId, email: input.email },
      });

      if (existing) {
        return this.prisma.contact.update({
          where: { id: existing.id },
          data: {
            ...(existing.name || !input.name ? {} : { name: input.name }),
            ...(existing.phone || !input.phone ? {} : { phone: input.phone }),
            consentStatus: "GRANTED",
            consentSource: input.consentSource,
            consentTextVersion: input.consentTextVersion ?? null,
            consentAt: now,
          },
        });
      }
    }

    return this.prisma.contact.create({
      data: {
        organizationId: input.organizationId,
        name: input.name ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        source: input.consentSource,
        consentStatus: "GRANTED",
        consentSource: input.consentSource,
        consentTextVersion: input.consentTextVersion ?? null,
        consentAt: now,
      },
    });
  }
}
