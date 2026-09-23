import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Contact, ContactEvent, Prisma as PrismaTypes, PrismaClient } from "@impulza/database";
import type {
  CreateContactInput,
  CreateContactNoteInput,
  ListContactsQuery,
  UpdateContactInput,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";

export interface ContactFromSubmissionInput {
  organizationId: string;
  name?: string;
  email?: string;
  phone?: string;
  /** `form:<formId>` — de dónde salió el consentimiento, para la auditoría de ADR-004 punto 3. */
  consentSource: string;
  consentTextVersion?: string;
}

export type ContactWithEvents = Contact & { events: ContactEvent[] };

/** Núcleo del mini-CRM (F3.3): matching/creación desde formularios (F3.2) más el CRUD completo. */
@Injectable()
export class ContactsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

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

  async listContacts(organizationId: string, filters: ListContactsQuery): Promise<Contact[]> {
    return this.prisma.contact.findMany({
      where: {
        organizationId,
        ...(filters.tag ? { tags: { has: filters.tag } } : {}),
        ...(filters.commercialStatus ? { commercialStatus: filters.commercialStatus } : {}),
        ...(filters.consentStatus ? { consentStatus: filters.consentStatus } : {}),
        ...(filters.search
          ? {
              OR: [
                { name: { contains: filters.search, mode: "insensitive" } },
                { email: { contains: filters.search, mode: "insensitive" } },
                { phone: { contains: filters.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private async getContactOrThrow(organizationId: string, contactId: string): Promise<ContactWithEvents> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId },
      include: { events: { orderBy: { createdAt: "desc" } } },
    });

    if (!contact) {
      throw new NotFoundException("Contacto no encontrado.");
    }

    return contact;
  }

  async getContact(organizationId: string, contactId: string): Promise<ContactWithEvents> {
    return this.getContactOrThrow(organizationId, contactId);
  }

  /** Alta manual (ADR-004: sin formulario público de por medio, el consentimiento queda
   *  `UNKNOWN` por defecto — nadie puede declarar "otorgado" un consentimiento que no se dio). */
  async createContact(organizationId: string, actorId: string, input: CreateContactInput): Promise<Contact> {
    const contact = await this.prisma.contact.create({
      data: {
        organizationId,
        name: input.name ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        source: input.source ?? "manual",
        tags: input.tags ?? [],
      },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "contact.created",
      targetType: "Contact",
      targetId: contact.id,
      metadata: { source: contact.source },
    });

    return contact;
  }

  async updateContact(
    organizationId: string,
    actorId: string,
    contactId: string,
    changes: UpdateContactInput,
  ): Promise<ContactWithEvents> {
    const contact = await this.getContactOrThrow(organizationId, contactId);

    await this.prisma.contact.update({
      where: { id: contact.id },
      data: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.email === undefined ? {} : { email: changes.email }),
        ...(changes.phone === undefined ? {} : { phone: changes.phone }),
        ...(changes.tags === undefined ? {} : { tags: changes.tags }),
        ...(changes.commercialStatus === undefined ? {} : { commercialStatus: changes.commercialStatus }),
        ...(changes.assignedToId === undefined ? {} : { assignedToId: changes.assignedToId }),
      },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "contact.updated",
      targetType: "Contact",
      targetId: contact.id,
      metadata: changes,
    });

    return this.getContactOrThrow(organizationId, contactId);
  }

  async addNote(
    organizationId: string,
    actorId: string,
    contactId: string,
    input: CreateContactNoteInput,
  ): Promise<ContactWithEvents> {
    const contact = await this.getContactOrThrow(organizationId, contactId);

    await this.prisma.contactEvent.create({
      data: {
        contactId: contact.id,
        type: "NOTE",
        payload: { note: input.note, authorId: actorId } as PrismaTypes.InputJsonValue,
      },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "contact.note_added",
      targetType: "Contact",
      targetId: contact.id,
      metadata: {},
    });

    return this.getContactOrThrow(organizationId, contactId);
  }

  /**
   * Borrado real en cascada (ADR-004 punto 5, derecho de cancelación): se lleva `ContactEvent` y
   * `FormSubmission` vinculados (cascada de F3.1) y queda auditado con el actor real — es el
   * mecanismo operable para atender una solicitud ARCO+, no una tarea manual de soporte.
   */
  async deleteContact(organizationId: string, actorId: string, contactId: string): Promise<void> {
    const contact = await this.getContactOrThrow(organizationId, contactId);

    await this.prisma.contact.delete({ where: { id: contact.id } });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "contact.deleted",
      targetType: "Contact",
      targetId: contact.id,
      metadata: { email: contact.email, name: contact.name },
    });
  }

  /**
   * Portabilidad ARCO+ (ADR-004 punto 5): todos los datos propios de un contacto, incluida su
   * línea de tiempo completa, en un formato legible. Auditado como una lectura sensible, no una
   * lectura cualquiera — es exactamente el tipo de acceso que una solicitud de un titular real
   * necesita poder demostrar que quedó registrado.
   */
  async exportContact(organizationId: string, actorId: string, contactId: string): Promise<ContactWithEvents> {
    const contact = await this.getContactOrThrow(organizationId, contactId);

    await this.auditService.record({
      organizationId,
      actorId,
      action: "contact.exported",
      targetType: "Contact",
      targetId: contact.id,
      metadata: {},
    });

    return contact;
  }
}
