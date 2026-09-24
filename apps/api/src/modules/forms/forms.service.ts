import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Form, FormField, Prisma as PrismaTypes, PrismaClient } from "@impulza/database";
import type {
  CreateFormFieldInput,
  CreateFormInput,
  UpdateFormFieldInput,
  UpdateFormInput,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { PlansService } from "../plans/plans.service.js";

type FormWithFields = Form & { fields: FormField[] };

/** Forma de respuesta de la API: mismo criterio que `BlockWithConfig` (F2.4) — el tipo interno de
 *  Prisma no es el contrato público, se traduce siempre por `toFormResponse`. */
export interface FormResponseShape {
  id: string;
  siteId: string;
  name: string;
  type: Form["type"];
  successAction: unknown;
  fields: Array<{
    id: string;
    formId: string;
    type: FormField["type"];
    label: string;
    required: boolean;
    options: string[] | null;
    position: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class FormsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly plansService: PlansService,
  ) {}

  /** Igual patrón que `PagesService`/`BlocksService`: 404 y no 403 ante un id cruzado (ADR-002). */
  private async assertSiteInOrganization(organizationId: string, siteId: string): Promise<void> {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, organizationId },
      select: { id: true },
    });

    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
  }

  private async getFormOrThrow(
    organizationId: string,
    siteId: string,
    formId: string,
  ): Promise<FormWithFields> {
    const form = await this.prisma.form.findFirst({
      where: { id: formId, siteId, site: { organizationId } },
      include: { fields: { orderBy: { position: "asc" } } },
    });

    if (!form) {
      throw new NotFoundException("Formulario no encontrado.");
    }

    return form;
  }

  private toResponse(form: FormWithFields): FormResponseShape {
    return {
      id: form.id,
      siteId: form.siteId,
      name: form.name,
      type: form.type,
      successAction: form.successAction,
      fields: form.fields.map((field) => ({
        id: field.id,
        formId: field.formId,
        type: field.type,
        label: field.label,
        required: field.required,
        options: (field.options as string[] | null) ?? null,
        position: field.position,
        createdAt: field.createdAt,
        updatedAt: field.updatedAt,
      })),
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
    };
  }

  async listForms(organizationId: string, siteId: string): Promise<FormResponseShape[]> {
    await this.assertSiteInOrganization(organizationId, siteId);

    const forms = await this.prisma.form.findMany({
      where: { siteId },
      orderBy: { createdAt: "asc" },
      include: { fields: { orderBy: { position: "asc" } } },
    });

    return forms.map((form) => this.toResponse(form));
  }

  async getForm(organizationId: string, siteId: string, formId: string): Promise<FormResponseShape> {
    return this.toResponse(await this.getFormOrThrow(organizationId, siteId, formId));
  }

  async createForm(
    organizationId: string,
    actorId: string,
    siteId: string,
    input: CreateFormInput,
  ): Promise<FormResponseShape> {
    await this.assertSiteInOrganization(organizationId, siteId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.plansService.assertWithinLimit(tx, organizationId, "forms");
      const form = await tx.form.create({
        data: {
          siteId,
          name: input.name,
          type: input.type,
          successAction: input.successAction as PrismaTypes.InputJsonValue,
        },
      });

      if (input.fields && input.fields.length > 0) {
        await tx.formField.createMany({
          data: input.fields.map((field, index) => ({
            formId: form.id,
            type: field.type,
            label: field.label,
            required: field.required,
            options: (field.options ?? null) as PrismaTypes.InputJsonValue,
            position: index,
          })),
        });
      }

      return tx.form.findFirstOrThrow({
        where: { id: form.id },
        include: { fields: { orderBy: { position: "asc" } } },
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "form.created",
      targetType: "Form",
      targetId: created.id,
      metadata: { siteId, name: created.name, fieldCount: created.fields.length },
    });

    return this.toResponse(created);
  }

  async updateForm(
    organizationId: string,
    actorId: string,
    siteId: string,
    formId: string,
    changes: UpdateFormInput,
  ): Promise<FormResponseShape> {
    const form = await this.getFormOrThrow(organizationId, siteId, formId);

    const updated = await this.prisma.form.update({
      where: { id: form.id },
      data: {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.type === undefined ? {} : { type: changes.type }),
        ...(changes.successAction === undefined
          ? {}
          : { successAction: changes.successAction as PrismaTypes.InputJsonValue }),
      },
      include: { fields: { orderBy: { position: "asc" } } },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "form.updated",
      targetType: "Form",
      targetId: form.id,
      metadata: { siteId, ...changes },
    });

    return this.toResponse(updated);
  }

  /**
   * Borrado real, no lógico: a diferencia de una `Page`, un `Form` no tiene historial propio del
   * que el usuario espere recuperación (mismo criterio que borrar un `Block` suelto, F2.4/F2.9) —
   * y borrar de verdad es justo lo que hace falta para que un formulario mal configurado deje de
   * aceptar envíos sin dejar una fila fantasma. Se le informa al usuario en el propio endpoint que
   * esto se lleva también los envíos ya recibidos (`FormSubmission` cascada), no un detalle oculto.
   */
  async deleteForm(organizationId: string, actorId: string, siteId: string, formId: string): Promise<void> {
    const form = await this.getFormOrThrow(organizationId, siteId, formId);

    await this.prisma.form.delete({ where: { id: form.id } });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "form.deleted",
      targetType: "Form",
      targetId: form.id,
      metadata: { siteId, name: form.name, submissionsLost: true },
    });
  }

  async addField(
    organizationId: string,
    actorId: string,
    siteId: string,
    formId: string,
    input: CreateFormFieldInput,
  ): Promise<FormResponseShape> {
    const form = await this.getFormOrThrow(organizationId, siteId, formId);

    const created = await this.prisma.$transaction(async (tx) => {
      const last = await tx.formField.findFirst({
        where: { formId: form.id },
        orderBy: { position: "desc" },
        select: { position: true },
      });

      await tx.formField.create({
        data: {
          formId: form.id,
          type: input.type,
          label: input.label,
          required: input.required,
          options: (input.options ?? null) as PrismaTypes.InputJsonValue,
          position: (last?.position ?? -1) + 1,
        },
      });

      return tx.form.findFirstOrThrow({
        where: { id: form.id },
        include: { fields: { orderBy: { position: "asc" } } },
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "form.field_added",
      targetType: "Form",
      targetId: form.id,
      metadata: { siteId, fieldType: input.type, fieldLabel: input.label },
    });

    return this.toResponse(created);
  }

  private async getFieldOrThrow(
    organizationId: string,
    siteId: string,
    formId: string,
    fieldId: string,
  ): Promise<FormField> {
    const field = await this.prisma.formField.findFirst({
      where: { id: fieldId, formId, form: { siteId, site: { organizationId } } },
    });

    if (!field) {
      throw new NotFoundException("Campo de formulario no encontrado.");
    }

    return field;
  }

  async updateField(
    organizationId: string,
    actorId: string,
    siteId: string,
    formId: string,
    fieldId: string,
    changes: UpdateFormFieldInput,
  ): Promise<FormResponseShape> {
    const field = await this.getFieldOrThrow(organizationId, siteId, formId, fieldId);

    if (changes.options !== undefined && field.type !== "SELECT") {
      throw new BadRequestException("Solo un campo `SELECT` puede tener opciones.");
    }

    await this.prisma.formField.update({
      where: { id: field.id },
      data: {
        ...(changes.label === undefined ? {} : { label: changes.label }),
        ...(changes.required === undefined ? {} : { required: changes.required }),
        ...(changes.options === undefined
          ? {}
          : { options: changes.options as PrismaTypes.InputJsonValue }),
        ...(changes.position === undefined ? {} : { position: changes.position }),
      },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "form.field_updated",
      targetType: "Form",
      targetId: formId,
      metadata: { siteId, fieldId: field.id, ...changes },
    });

    return this.getForm(organizationId, siteId, formId);
  }

  async deleteField(
    organizationId: string,
    actorId: string,
    siteId: string,
    formId: string,
    fieldId: string,
  ): Promise<FormResponseShape> {
    const field = await this.getFieldOrThrow(organizationId, siteId, formId, fieldId);

    await this.prisma.$transaction(async (tx) => {
      await tx.formField.delete({ where: { id: field.id } });
      // Cierra el hueco de posiciones (mismo criterio que borrar un Block, F2.4).
      await tx.formField.updateMany({
        where: { formId, position: { gt: field.position } },
        data: { position: { decrement: 1 } },
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "form.field_deleted",
      targetType: "Form",
      targetId: formId,
      metadata: { siteId, fieldId: field.id },
    });

    return this.getForm(organizationId, siteId, formId);
  }
}
