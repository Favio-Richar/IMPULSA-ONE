import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Form, FormField, Prisma as PrismaTypes, PrismaClient } from "@impulza/database";
import {
  buildFormSubmissionSchema,
  extractContactSignals,
  HONEYPOT_FIELD_KEY,
  type SubmittableFormField,
} from "@impulza/validation";
import type { Request } from "express";
import { PRISMA } from "../../database/prisma.module.js";
import { AnalyticsService } from "../analytics/analytics.service.js";
import { ContactsService } from "../contacts/contacts.service.js";

type FormWithFields = Form & { fields: FormField[]; site: { organizationId: string } };

export interface PublicFormShape {
  id: string;
  name: string;
  fields: Array<{
    id: string;
    type: FormField["type"];
    label: string;
    required: boolean;
    options: string[] | null;
    position: number;
  }>;
}

export interface SubmissionAckShape {
  message: string;
  redirectUrl?: string;
}

@Injectable()
export class PublicFormsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly contactsService: ContactsService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  private toSubmittableFields(form: FormWithFields): SubmittableFormField[] {
    return form.fields.map((field) => ({
      id: field.id,
      type: field.type,
      label: field.label,
      required: field.required,
      options: (field.options as string[] | null) ?? null,
    }));
  }

  /**
   * Un sitio archivado no expone sus formularios, mismo criterio de "solo contenido alcanzable
   * públicamente" que el render de sitios/páginas (F2.7) — un `Form` no está atado al estado de
   * publicación de una página puntual (vive a nivel de sitio, ERD.md §5), así que la única señal
   * de "¿esto sigue siendo público?" disponible acá es que el sitio no esté archivado.
   */
  private async getFormOrThrow(siteSlug: string, formId: string): Promise<FormWithFields> {
    const form = await this.prisma.form.findFirst({
      where: { id: formId, site: { slug: siteSlug, status: { not: "ARCHIVED" } } },
      include: {
        fields: { orderBy: { position: "asc" } },
        site: { select: { organizationId: true } },
      },
    });

    if (!form) {
      throw new NotFoundException("Formulario no encontrado.");
    }

    return form;
  }

  async getPublicForm(siteSlug: string, formId: string): Promise<PublicFormShape> {
    const form = await this.getFormOrThrow(siteSlug, formId);

    return {
      id: form.id,
      name: form.name,
      fields: form.fields.map((field) => ({
        id: field.id,
        type: field.type,
        label: field.label,
        required: field.required,
        options: (field.options as string[] | null) ?? null,
        position: field.position,
      })),
    };
  }

  async submit(
    siteSlug: string,
    formId: string,
    rawPayload: Record<string, unknown>,
    request: Request,
  ): Promise<SubmissionAckShape> {
    const form = await this.getFormOrThrow(siteSlug, formId);
    const successAction = form.successAction as unknown as SubmissionAckShape;

    // Antispam (F3.2): un bot real completa hasta los campos ocultos. Se responde éxito igual —
    // avisarle que falló solo le enseña a evadir el honeypot la próxima vez — pero no se persiste
    // nada.
    const honeypotValue = rawPayload[HONEYPOT_FIELD_KEY];
    if (typeof honeypotValue === "string" && honeypotValue.length > 0) {
      return successAction;
    }

    const fields = this.toSubmittableFields(form);
    const schema = buildFormSubmissionSchema(fields);
    const parsed = schema.safeParse(rawPayload);

    if (!parsed.success) {
      throw new BadRequestException({
        message: "El envío no cumple con los campos del formulario.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se descarta el honeypot del payload persistido.
    const { [HONEYPOT_FIELD_KEY]: _honeypot, ...payload } = parsed.data as Record<string, unknown>;
    const signals = extractContactSignals(fields, payload);

    // Se resuelve *antes* de la transacción de abajo: `ContactsService` usa el cliente de Prisma
    // compartido, no uno transaccional, así que anidarlo dentro de `$transaction` no lo cubriría
    // de todos modos (ADR-004 punto 3: sin CONSENT marcado, no hay Contact en absoluto).
    const contactResult = signals.consentGranted
      ? await this.contactsService.findOrCreateFromSubmission({
          organizationId: form.site.organizationId,
          name: signals.name,
          email: signals.email,
          phone: signals.phone,
          consentSource: `form:${form.id}`,
        })
      : null;
    const contactId = contactResult?.contact.id ?? null;

    const submissionId = await this.prisma.$transaction(async (tx) => {
      const submission = await tx.formSubmission.create({
        data: {
          formId: form.id,
          contactId,
          payload: payload as PrismaTypes.InputJsonValue,
        },
      });

      if (contactId) {
        await tx.contactEvent.create({
          data: {
            contactId,
            type: "FORM_SUBMISSION",
            payload: { formId: form.id, submissionId: submission.id } as PrismaTypes.InputJsonValue,
          },
        });
      }

      return submission.id;
    });

    // Después de confirmar la transacción, nunca dentro: un evento de analítica no puede quedar
    // registrado por un envío que terminó revertido. Claves de idempotencia atadas al envío y al
    // contacto, así un reintento del job jamás cuenta dos veces el mismo lead (F3.6).
    await this.analyticsService.recordEvent({
      organizationId: form.site.organizationId,
      siteId: form.siteId,
      type: "form_submit",
      request,
      subjectId: form.id,
      idempotencyKey: `form_submit:${submissionId}`,
    });
    if (contactResult?.created) {
      await this.analyticsService.recordEvent({
        organizationId: form.site.organizationId,
        siteId: form.siteId,
        type: "lead_created",
        request,
        subjectId: form.id,
        idempotencyKey: `lead_created:${contactResult.contact.id}`,
      });
    }

    return successAction;
  }
}
