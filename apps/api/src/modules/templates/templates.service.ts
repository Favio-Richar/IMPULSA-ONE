import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { TemplateResponse } from "@impulza/contracts";
import type { PrismaClient, Template } from "@impulza/database";
import { getCatalogTheme, templateSchema, type TemplateDefinition } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import type { ListTemplatesQueryDto } from "./dto/list-templates-query.dto.js";

export const TEMPLATE_NOT_FOUND = "Plantilla no encontrada.";

/**
 * Catálogo de plantillas (PL1). Contenido global de la plataforma: no hay organización en juego,
 * así que no hay nada que aislar entre tenants — solo se lee.
 *
 * Cada fila se valida con `templateSchema` **al leer**, no solo al sembrar: las columnas JSON no se
 * creen a ciegas, y un bloque de ejemplo que dejó de cumplir su esquema (un cambio en el catálogo de
 * bloques) no puede llegar a la página de un cliente al aplicarse.
 */
@Injectable()
export class TemplatesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** La fila validada, o `null` si ya no cumple el esquema (queda registrado para corregir el seed). */
  private parseRow(row: Template): TemplateDefinition | null {
    const parsed = templateSchema.safeParse({
      code: row.code,
      name: row.name,
      description: row.description,
      industryTags: row.industryTags,
      objectiveTags: row.objectiveTags,
      themeCode: row.themeCode,
      family: row.family,
      background: row.background,
      previewImageUrl: row.previewImageUrl,
      blocksSeed: row.blocksSeed,
      sortOrder: row.sortOrder,
    });

    if (!parsed.success) {
      logger.error("plantilla inválida en la base: se omite", {
        templateCode: row.code,
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
      return null;
    }

    return parsed.data;
  }

  private toResponse(id: string, template: TemplateDefinition): TemplateResponse {
    // `templateSchema` ya garantizó que el tema existe en el catálogo.
    const theme = getCatalogTheme(template.themeCode)!;

    return {
      id,
      code: template.code,
      name: template.name,
      description: template.description,
      industryTags: template.industryTags,
      objectiveTags: template.objectiveTags,
      family: template.family,
      theme: { code: theme.code, name: theme.name, tokens: theme.tokens },
      background: template.background,
      previewImageUrl: template.previewImageUrl,
      blocks: template.blocksSeed.map((block) => ({
        type: block.type,
        configSchemaVersion: block.configSchemaVersion,
        ...(block.isPrimary ? { isPrimary: true as const } : {}),
        config: block.config,
      })),
    };
  }

  async listTemplates(filters: ListTemplatesQueryDto): Promise<TemplateResponse[]> {
    const rows = await this.prisma.template.findMany({
      where: {
        // Una plantilla que el superadministrador oculta (F7.11) deja de verse en la galería pública.
        isActive: true,
        ...(filters.industry ? { industryTags: { has: filters.industry } } : {}),
        ...(filters.objective ? { objectiveTags: { has: filters.objective } } : {}),
        ...(filters.family ? { family: filters.family } : {}),
      },
      // Las destacadas primero; dentro de cada grupo, el orden que fijó el superadministrador.
      orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { code: "asc" }],
    });

    // Una plantilla rota se omite en vez de tumbar toda la galería (degradación controlada, F2.4).
    return rows.flatMap((row) => {
      const template = this.parseRow(row);
      return template ? [this.toResponse(row.id, template)] : [];
    });
  }

  /**
   * Plantilla válida por código. La usa también la aplicación de una plantilla a un sitio (PL4):
   * lo que se copia a la página es siempre lo que acaba de pasar por el esquema.
   */
  async getTemplate(code: string): Promise<TemplateResponse> {
    const found = await this.prisma.template.findUnique({ where: { code } });
    // Oculta = no disponible, tampoco para aplicarla a un sitio nuevo (los sitios ya creados no cambian).
    const row = found?.isActive ? found : null;
    const template = row ? this.parseRow(row) : null;

    if (!row || !template) {
      throw new NotFoundException(TEMPLATE_NOT_FOUND);
    }

    return this.toResponse(row.id, template);
  }
}
