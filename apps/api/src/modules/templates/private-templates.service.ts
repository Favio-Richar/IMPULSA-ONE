import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { PrivateTemplateResponse } from "@impulza/contracts";
import type { Prisma, PrismaClient } from "@impulza/database";
import {
  DEFAULT_THEME_CODE,
  PRIVATE_TEMPLATES_PER_ORGANIZATION_MAX,
  getCatalogTheme,
  privateTemplateCode,
  stripOrganizationReferences,
  templateBackgroundSchema,
  templateSchema,
  type CreatePrivateTemplateDto,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { TemplatesService } from "./templates.service.js";

/**
 * Plantillas privadas (F9.7c, ADR-028). Reglas que se aplican aquí, en el servidor:
 * - se crean a partir de una página de la PROPIA organización (cadena organización → sitio → página) y nunca arrastran referencias a sus
 *   formularios, servicios o productos;
 * - lo guardado pasa por el mismo `templateSchema` que el catálogo: una plantilla que no lo cumple no se guarda;
 * - solo la organización dueña las borra; una agencia delegada las ve y las aplica en sus clientes, pero no las toca ahí;
 * - hay un tope por organización, y todo queda en la auditoría.
 */
@Injectable()
export class PrivateTemplatesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly templatesService: TemplatesService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, actorId: string, dto: CreatePrivateTemplateDto): Promise<PrivateTemplateResponse> {
    // Organización → sitio → página, antes de mirar nada más (ADR-002): lo de otra organización responde 404.
    const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, organizationId }, include: { theme: true } });
    if (!site) throw new NotFoundException("Sitio no encontrado.");
    const page = await this.prisma.page.findFirst({ where: { id: dto.pageId, siteId: site.id, deletedAt: null } });
    if (!page) throw new NotFoundException("Página no encontrada.");

    const blocks = await this.prisma.block.findMany({
      where: { pageId: page.id, visible: true },
      orderBy: { position: "asc" },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (blocks.length === 0) {
      throw new ConflictException({ statusCode: 409, error: "Conflict", code: "EMPTY_PAGE", message: "La página no tiene bloques visibles: no hay nada que guardar como plantilla." });
    }

    // El tema y el fondo solo si son del catálogo (una plantilla nunca lleva un tema propio de la organización).
    const catalogTheme = dto.includeAppearance && site.theme && site.theme.organizationId === null && site.theme.code ? getCatalogTheme(site.theme.code) : undefined;
    const theme = catalogTheme ?? getCatalogTheme(DEFAULT_THEME_CODE)!;
    const background = dto.includeAppearance ? templateBackgroundSchema.safeParse(site.background) : null;

    const definition = {
      code: privateTemplateCode(organizationId, dto.name, randomBytes(4).toString("hex")),
      name: dto.name,
      description: dto.description,
      // Una plantilla privada no se filtra por rubro: etiquetas neutras (el esquema exige al menos una).
      industryTags: ["emprendimiento"],
      objectiveTags: ["mostrar"],
      themeCode: theme.code,
      family: theme.family,
      background: background && background.success ? background.data : null,
      previewImageUrl: null,
      blocksSeed: blocks.map((block) => ({
        type: block.type,
        configSchemaVersion: block.configSchemaVersion,
        ...(block.isPrimary ? { isPrimary: true as const } : {}),
        config: stripOrganizationReferences(block.versions[0]?.config ?? {}),
      })),
      sortOrder: 0,
    };

    const parsed = templateSchema.safeParse(definition);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: "Unprocessable Entity",
        message: "La página tiene un bloque que no se puede guardar como plantilla. Corrígelo e inténtalo de nuevo.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    const row = await this.prisma.$transaction(async (tx) => {
      // Dos peticiones a la vez no pasan del tope: el recuento y el alta van bajo el mismo candado.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`private-templates:${organizationId}`}, 0))`;
      if ((await tx.template.count({ where: { organizationId } })) >= PRIVATE_TEMPLATES_PER_ORGANIZATION_MAX) {
        throw new ConflictException({
          statusCode: 409,
          error: "Conflict",
          code: "TEMPLATE_LIMIT",
          message: `Una organización puede tener hasta ${PRIVATE_TEMPLATES_PER_ORGANIZATION_MAX} plantillas propias: borra alguna antes de guardar otra.`,
        });
      }
      return tx.template.create({
        data: {
          organizationId,
          code: parsed.data.code,
          name: parsed.data.name,
          description: parsed.data.description,
          industryTags: parsed.data.industryTags,
          objectiveTags: parsed.data.objectiveTags,
          themeCode: parsed.data.themeCode,
          family: parsed.data.family,
          background: parsed.data.background === null ? undefined : (parsed.data.background as Prisma.InputJsonValue),
          previewImageUrl: null,
          blocksSeed: parsed.data.blocksSeed as Prisma.InputJsonValue,
          sortOrder: 0,
          isActive: true,
          isFeatured: false,
        },
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "template.private_created",
      targetType: "Template",
      targetId: row.id,
      metadata: { name: row.name, code: row.code, blocks: parsed.data.blocksSeed.length, siteId: site.id, pageId: page.id },
    });
    return this.toResponse(row, organizationId);
  }

  private toResponse(row: Parameters<TemplatesService["toResponseFromRow"]>[0], viewerOrganizationId: string): PrivateTemplateResponse {
    const base = this.templatesService.toResponseFromRow(row);
    if (!base || !row.organizationId) {
      throw new UnprocessableEntityException("La plantilla guardada no cumple el esquema.");
    }
    return { ...base, ownerOrganizationId: row.organizationId, fromAgency: row.organizationId !== viewerOrganizationId, createdAt: row.createdAt.toISOString() };
  }

  /** Las plantillas propias de la organización y, con acceso delegado, las de la agencia con la que se trabaja. */
  async list(organizationId: string, membership: { source: string; agencyClientId: string | null }): Promise<PrivateTemplateResponse[]> {
    const owners = await this.templatesService.visibleOwnerIds(organizationId, membership);
    const rows = await this.prisma.template.findMany({
      where: { organizationId: { in: owners }, isActive: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    // Una plantilla rota se omite en vez de tumbar toda la lista.
    return rows.flatMap((row) => {
      const base = this.templatesService.toResponseFromRow(row);
      return base && row.organizationId
        ? [{ ...base, ownerOrganizationId: row.organizationId, fromAgency: row.organizationId !== organizationId, createdAt: row.createdAt.toISOString() }]
        : [];
    });
  }

  async remove(organizationId: string, actorId: string, templateId: string): Promise<void> {
    // Filtrada por la organización dueña: la de otra organización (o una del catálogo) es un 404.
    const row = await this.prisma.template.findFirst({ where: { id: templateId, organizationId } });
    if (!row) throw new NotFoundException("Plantilla no encontrada.");
    await this.prisma.template.delete({ where: { id: row.id } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "template.private_deleted",
      targetType: "Template",
      targetId: row.id,
      metadata: { name: row.name, code: row.code },
    });
  }
}
