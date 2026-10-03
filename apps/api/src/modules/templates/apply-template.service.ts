import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ApplyTemplateResponse, BlockResponse } from "@impulza/contracts";
import { PERMISSIONS, Prisma, type PrismaClient } from "@impulza/database";
import { applyOrganizationBrandDefaults, personalizeTemplateBlocks, type ApplyTemplateInput } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { BlocksService } from "../blocks/blocks.service.js";
import { BrandProfileService } from "../brand-profile/brand-profile.service.js";
import { PageVersionsService } from "../pages/page-versions.service.js";
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";
import { TemplatesService } from "./templates.service.js";

export const UNPUBLISHED_CHANGES_CODE = "UNPUBLISHED_CHANGES";

/**
 * Aplicar una plantilla a una página (PL4): reemplaza sus bloques por los de la plantilla
 * (personalizados con lo que el usuario contó en el onboarding) y, si se pide, aplica al sitio el
 * tema y el fondo de la plantilla. El sitio nunca queda atado a la plantilla: se copia su contenido,
 * que queda editable de inmediato como cualquier otro bloque.
 *
 * Reversibilidad:
 * - Los bloques anteriores se recuperan restaurando una versión publicada (historial, F2.6). Lo que
 *   ninguna versión guarda (cambios sin publicar, o una página nunca publicada con bloques) se
 *   perdería, así que eso exige confirmación explícita (`discardUnpublishedChanges`) o responde 409.
 * - El tema y el fondo se aplican en vivo y no tienen historial: la respuesta devuelve los
 *   anteriores para que el panel ofrezca deshacerlos, y quedan también en la auditoría.
 *
 * Los bloques nuevos no se publican: el visitante sigue viendo la última versión publicada hasta
 * que el usuario publique (el onboarding lo hace en su paso de publicación).
 */
@Injectable()
export class ApplyTemplateService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly templatesService: TemplatesService,
    private readonly blocksService: BlocksService,
    private readonly pageVersionsService: PageVersionsService,
    private readonly auditService: AuditService,
    private readonly revalidateWebService: RevalidateWebService,
    private readonly brandProfileService: BrandProfileService,
  ) {}

  async applyTemplate(
    organizationId: string,
    actorId: string,
    actorRoleId: string,
    siteId: string,
    pageId: string,
    input: ApplyTemplateInput,
  ): Promise<ApplyTemplateResponse> {
    // Organización → sitio → página, antes de mirar nada más (ADR-002): el sitio o la página de otra
    // organización responden 404, igual que en el resto de la API.
    const site = await this.prisma.site.findFirst({ where: { id: siteId, organizationId } });
    if (!site) {
      throw new NotFoundException("Sitio no encontrado.");
    }
    const hasUnpublishedChanges = await this.pageVersionsService.hasUnpublishedChanges(organizationId, siteId, pageId);

    // Cambiar el tema y el fondo es configuración del sitio (`site.update`), además del permiso de
    // contenido que ya exigió el guard (`page.manage`).
    if (input.applyAppearance) {
      const grant = await this.prisma.rolePermission.findFirst({
        where: { roleId: actorRoleId, permission: { key: PERMISSIONS.SITE_UPDATE } },
      });
      if (!grant) {
        throw new ForbiddenException("Tu rol no puede cambiar el tema ni el fondo del sitio.");
      }
    }

    const template = await this.templatesService.getTemplate(input.templateCode);

    if (hasUnpublishedChanges && !input.discardUnpublishedChanges) {
      throw new ConflictException({
        statusCode: 409,
        code: UNPUBLISHED_CHANGES_CODE,
        message:
          "La página tiene cambios que ninguna versión publicada guarda y se perderían. Publícalos antes, o confirma que quieres descartarlos.",
      });
    }

    // Cada bloque pasa por la misma puerta que crear un bloque a mano: esquema del tipo, texto
    // alternativo, saneo del texto enriquecido y medios propios.
    // F9.2 (criterio 4a): una página nueva nace con la marca propia de la organización —nombre visible y logo
    // como avatar— salvo lo que la persona ya escribió. Solo valores que la organización configuró, nunca los de
    // la plataforma; la cascada completa se usa donde corresponde mostrar la marca efectiva.
    const personalized = applyOrganizationBrandDefaults(
      personalizeTemplateBlocks(
        template.blocks.map((block) => ({ ...block })),
        input.personalization,
      ),
      await this.brandProfileService.getOwnBrand(organizationId),
      input.personalization?.name,
    );
    const prepared: Array<{ type: string; isPrimary: boolean; config: unknown; version: number }> = [];
    for (const block of personalized) {
      const { config, version } = await this.blocksService.prepareBlockConfig(organizationId, block.type, block.config);
      prepared.push({ type: block.type, isPrimary: block.isPrimary === true, config, version });
    }

    let themeId: string | null = null;
    if (input.applyAppearance) {
      const theme = await this.prisma.theme.findFirst({ where: { code: template.theme.code, organizationId: null } });
      if (!theme) {
        // El catálogo lo siembra `prisma/seed.ts`: si falta, el entorno está mal preparado.
        throw new NotFoundException(`El tema "${template.theme.code}" no está en la base. ¿Se ejecutó el seed?`);
      }
      themeId = theme.id;
    }

    const previous = { themeId: site.themeId, background: (site.background as unknown) ?? null };

    await this.prisma.$transaction(async (tx) => {
      await tx.block.deleteMany({ where: { pageId } });

      for (const [position, block] of prepared.entries()) {
        const created = await tx.block.create({
          data: { pageId, type: block.type, position, configSchemaVersion: block.version, isPrimary: block.isPrimary },
        });
        await tx.blockVersion.create({
          data: { blockId: created.id, versionNumber: 1, config: block.config as Prisma.InputJsonValue },
        });
      }

      if (input.applyAppearance) {
        await tx.site.update({
          where: { id: site.id },
          data: {
            themeId,
            background: template.background === null ? Prisma.DbNull : (template.background as Prisma.InputJsonValue),
          },
        });
      }
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "page.template_applied",
      targetType: "Page",
      targetId: pageId,
      metadata: {
        siteId,
        templateCode: template.code,
        blocks: prepared.length,
        discardedUnpublishedChanges: hasUnpublishedChanges,
        appearanceApplied: input.applyAppearance,
        themeFrom: previous.themeId,
        themeTo: input.applyAppearance ? themeId : previous.themeId,
        backgroundFrom: (previous.background as { kind?: string } | null)?.kind ?? null,
        ...(input.onboarding ? { onboarding: input.onboarding } : {}),
      },
    });
    logger.info("plantilla aplicada", {
      organizationId,
      siteId,
      pageId,
      templateCode: template.code,
      blocks: prepared.length,
      appearanceApplied: input.applyAppearance,
      fromOnboarding: input.onboarding !== undefined,
    });

    // El tema y el fondo se ven en vivo: la página pública tiene que verlos ya. Los bloques no, hasta
    // publicar, así que sin apariencia no hay nada que invalidar.
    if (input.applyAppearance) {
      await this.revalidateWebService.revalidateSite(site.id);
    }

    const blocks = await this.blocksService.listBlocks(organizationId, siteId, pageId);

    return {
      templateCode: template.code,
      pageId,
      blocks: blocks.map(
        (block): BlockResponse => ({
          ...block,
          scheduledStart: block.scheduledStart?.toISOString() ?? null,
          scheduledEnd: block.scheduledEnd?.toISOString() ?? null,
        }),
      ),
      appearance: { applied: input.applyAppearance, previous },
    };
  }
}
