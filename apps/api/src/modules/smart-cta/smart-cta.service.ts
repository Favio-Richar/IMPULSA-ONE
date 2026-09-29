import { HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@impulza/database";
import { isPrimaryActionBlockType, smartCtaSchema, type SmartCta } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";

export const SMART_CTA_BLOCK_INVALID = "SMART_CTA_BLOCK_INVALID";

/**
 * Smart CTA (F6.6): reglas cerradas que cambian la acción principal de una página. Se guardan en
 * vivo (no esperan a publicar) y cada cambio invalida la caché del sitio público. Solo apuntan a
 * bloques de acción **de la misma página**, dentro del sitio ya verificado en la organización.
 */
@Injectable()
export class SmartCtaService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly revalidateWeb: RevalidateWebService,
  ) {}

  async get(organizationId: string, siteId: string, pageId: string) {
    const page = await this.pageOrThrow(organizationId, siteId, pageId);
    const parsed = smartCtaSchema.safeParse(page.smartCta ?? { rules: [] });
    return { rules: parsed.success ? parsed.data.rules : [], hoursConfigured: await this.hoursConfigured(siteId) };
  }

  async update(organizationId: string, actorId: string, siteId: string, pageId: string, input: SmartCta) {
    await this.pageOrThrow(organizationId, siteId, pageId);
    const blockIds = [...new Set(input.rules.map((rule) => rule.blockId))];
    const blocks = await this.prisma.block.findMany({ where: { id: { in: blockIds }, pageId }, select: { id: true, type: true } });
    const valid = new Set(blocks.filter((block) => isPrimaryActionBlockType(block.type)).map((block) => block.id));
    if (blockIds.some((id) => !valid.has(id))) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: "Unprocessable Entity",
        code: SMART_CTA_BLOCK_INVALID,
        message: "Cada regla tiene que apuntar a un botón de acción de esta página (WhatsApp, enlace, formulario o reservas).",
      });
    }

    // `Prisma.DbNull` y no `null`: en una columna JSON, `null` llano no la deja en NULL.
    await this.prisma.page.update({
      where: { id: pageId },
      data: { smartCta: input.rules.length > 0 ? (input as Prisma.InputJsonValue) : Prisma.DbNull },
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "page.smart_cta_updated",
      targetType: "Page",
      targetId: pageId,
      metadata: { conditions: input.rules.map((rule) => rule.condition.kind) },
    });
    logger.info("reglas de Smart CTA guardadas", { organizationId, pageId, rules: input.rules.length });
    await this.revalidateWeb.revalidateSite(siteId);
    return this.get(organizationId, siteId, pageId);
  }

  private async pageOrThrow(organizationId: string, siteId: string, pageId: string) {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, siteId, deletedAt: null, site: { organizationId } },
      select: { id: true, smartCta: true },
    });
    if (!page) {
      throw new NotFoundException("Página no encontrada.");
    }
    return page;
  }

  private async hoursConfigured(siteId: string): Promise<boolean> {
    return (await this.prisma.bookingSettings.count({ where: { siteId } })) > 0;
  }
}
