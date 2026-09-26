import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { type Block, MediaStatus, type Prisma as PrismaTypes, type PrismaClient } from "@impulza/database";
import { parseMediaUrl, type StorageAdapter } from "@impulza/storage";
import {
  findImagesWithoutAlt,
  getBlockDefinition,
  IMAGE_ALT_REQUIRED_MESSAGE,
  isPrimaryActionBlockType,
  parseStoredBlock,
} from "@impulza/validation";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { STORAGE } from "../../storage/storage.module.js";
import { AuditService } from "../audit/audit.service.js";
import { sanitizeBlockConfig } from "./sanitize.js";

/** Bloque tal como lo devuelve la API: el bloque más la configuración de su versión vigente. */
export interface BlockWithConfig {
  id: string;
  pageId: string;
  type: string;
  position: number;
  configSchemaVersion: number;
  visible: boolean;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  /** Acción principal de la página (PP5). */
  isPrimary: boolean;
  config: unknown;
  /** Motivo por el que el bloque no se puede renderizar, o `null` si está sano (F2.4). */
  degraded: "unknown_type" | "future_version" | "invalid_config" | null;
}

@Injectable()
export class BlocksService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    @Inject(STORAGE) private readonly storage: StorageAdapter | null,
  ) {}

  /**
   * Toda URL de medios propia dentro de la configuración tiene que ser de **esta** organización y de
   * un archivo listo (ADR-006 §9). Sin esto, alguien podría usar en su página imágenes de otra
   * organización (y, al borrarlas su dueña, la página ajena quedaría rota) o una imagen que aún se
   * está procesando. Las URLs externas (https de otro dominio) siguen permitidas como antes.
   */
  private async assertMediaOwnership(organizationId: string, config: unknown): Promise<void> {
    if (!this.storage) {
      return;
    }
    const base = this.storage.publicUrl("").replace(/\/+$/, "");
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") {
        strings.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(collect);
      }
    };
    collect(config);

    const references = strings.map((value) => parseMediaUrl(value, base)).filter((ref) => ref !== null);
    if (references.length === 0) {
      return;
    }
    if (references.some((ref) => ref.organizationId !== organizationId)) {
      throw new UnprocessableEntityException("Esa imagen pertenece a otra organización.");
    }
    const assetIds = [...new Set(references.map((ref) => ref.assetId))];
    const ready = await this.prisma.mediaAsset.count({
      where: { id: { in: assetIds }, organizationId, status: MediaStatus.READY },
    });
    if (ready !== assetIds.length) {
      throw new UnprocessableEntityException("La imagen ya no existe o todavía se está procesando.");
    }
  }

  /** Valida la cadena completa organización → sitio → página antes de tocar cualquier bloque. */
  private async assertPageInOrganization(
    organizationId: string,
    siteId: string,
    pageId: string,
  ): Promise<void> {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, siteId, deletedAt: null, site: { organizationId } },
      select: { id: true },
    });

    if (!page) {
      throw new NotFoundException("Página no encontrada.");
    }
  }

  private async getBlockOrThrow(
    organizationId: string,
    siteId: string,
    pageId: string,
    blockId: string,
  ): Promise<Block> {
    const block = await this.prisma.block.findFirst({
      where: {
        id: blockId,
        pageId,
        page: { siteId, deletedAt: null, site: { organizationId } },
      },
    });

    if (!block) {
      throw new NotFoundException("Bloque no encontrado.");
    }

    return block;
  }

  /**
   * Valida la configuración contra el esquema del tipo y la sanitiza. Este es el único camino por
   * el que una configuración llega a la base: no existe forma de guardar un bloque sin pasar por
   * acá, que es lo que convierte "bloques tipados, no HTML arbitrario" (ST §22) en una garantía y
   * no en una intención.
   */
  private validateAndSanitize(type: string, config: unknown): { config: unknown; version: number } {
    const definition = getBlockDefinition(type);

    if (!definition) {
      throw new BadRequestException(`Tipo de bloque no soportado: ${type}`);
    }

    const parsed = definition.schema.safeParse(config);

    if (!parsed.success) {
      throw new UnprocessableEntityException({
        message: "La configuración del bloque no es válida.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    // Texto alternativo obligatorio al guardar (PP2, WCAG 1.1.1). Va aparte del esquema a propósito:
    // ver `findImagesWithoutAlt`.
    const missingAlt = findImagesWithoutAlt(parsed.data);
    if (missingAlt.length > 0) {
      throw new UnprocessableEntityException({
        message: "La configuración del bloque no es válida.",
        issues: missingAlt.map((path) => ({ path: path.join("."), message: IMAGE_ALT_REQUIRED_MESSAGE })),
      });
    }

    return {
      config: sanitizeBlockConfig(type, parsed.data),
      version: definition.version,
    };
  }

  /** Une el bloque con la configuración de su última versión y marca si está degradado. */
  private toBlockWithConfig(
    block: Block & { versions: Array<{ config: PrismaTypes.JsonValue }> },
  ): BlockWithConfig {
    const rawConfig = block.versions[0]?.config ?? null;
    const parsed = parseStoredBlock(block.type, block.configSchemaVersion, rawConfig);

    return {
      id: block.id,
      pageId: block.pageId,
      type: block.type,
      position: block.position,
      configSchemaVersion: block.configSchemaVersion,
      visible: block.visible,
      scheduledStart: block.scheduledStart,
      scheduledEnd: block.scheduledEnd,
      isPrimary: block.isPrimary,
      config: rawConfig,
      degraded: parsed.renderable ? null : parsed.reason,
    };
  }

  async listBlocks(organizationId: string, siteId: string, pageId: string): Promise<BlockWithConfig[]> {
    await this.assertPageInOrganization(organizationId, siteId, pageId);

    const blocks = await this.prisma.block.findMany({
      where: { pageId },
      orderBy: { position: "asc" },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });

    return blocks.map((block) => this.toBlockWithConfig(block));
  }

  async createBlock(
    organizationId: string,
    actorId: string,
    siteId: string,
    pageId: string,
    input: {
      type: string;
      config: unknown;
      visible?: boolean;
      scheduledStart?: string;
      scheduledEnd?: string;
    },
  ): Promise<BlockWithConfig> {
    await this.assertPageInOrganization(organizationId, siteId, pageId);
    const { config, version } = this.validateAndSanitize(input.type, input.config);
    await this.assertMediaOwnership(organizationId, config);
    this.assertScheduleOrder(input.scheduledStart, input.scheduledEnd);

    const created = await this.prisma.$transaction(async (tx) => {
      const last = await tx.block.findFirst({
        where: { pageId },
        orderBy: { position: "desc" },
        select: { position: true },
      });

      const block = await tx.block.create({
        data: {
          pageId,
          type: input.type,
          position: (last?.position ?? -1) + 1,
          configSchemaVersion: version,
          ...(input.visible === undefined ? {} : { visible: input.visible }),
          ...(input.scheduledStart === undefined ? {} : { scheduledStart: new Date(input.scheduledStart) }),
          ...(input.scheduledEnd === undefined ? {} : { scheduledEnd: new Date(input.scheduledEnd) }),
        },
      });

      // La configuración vive en BlockVersion (ERD §3): el bloque tiene historial propio desde el
      // primer guardado, independiente del historial de la página.
      await tx.blockVersion.create({
        data: { blockId: block.id, versionNumber: 1, config: config as PrismaTypes.InputJsonValue },
      });

      return tx.block.findFirstOrThrow({
        where: { id: block.id },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "block.created",
      targetType: "Block",
      targetId: created.id,
      metadata: { pageId, type: input.type },
    });

    return this.toBlockWithConfig(created);
  }

  async updateBlock(
    organizationId: string,
    actorId: string,
    siteId: string,
    pageId: string,
    blockId: string,
    changes: {
      config?: unknown;
      visible?: boolean;
      scheduledStart?: string | null;
      scheduledEnd?: string | null;
    },
  ): Promise<BlockWithConfig> {
    const block = await this.getBlockOrThrow(organizationId, siteId, pageId, blockId);

    const sanitized =
      changes.config === undefined ? null : this.validateAndSanitize(block.type, changes.config);
    if (sanitized) {
      await this.assertMediaOwnership(organizationId, sanitized.config);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (sanitized) {
        // Cada guardado de configuración crea una versión nueva; no se pisa la anterior.
        const last = await tx.blockVersion.findFirst({
          where: { blockId: block.id },
          orderBy: { versionNumber: "desc" },
          select: { versionNumber: true },
        });

        await tx.blockVersion.create({
          data: {
            blockId: block.id,
            versionNumber: (last?.versionNumber ?? 0) + 1,
            config: sanitized.config as PrismaTypes.InputJsonValue,
          },
        });
      }

      await tx.block.update({
        where: { id: block.id },
        data: {
          ...(sanitized ? { configSchemaVersion: sanitized.version } : {}),
          ...(changes.visible === undefined ? {} : { visible: changes.visible }),
          ...(changes.scheduledStart === undefined
            ? {}
            : { scheduledStart: changes.scheduledStart === null ? null : new Date(changes.scheduledStart) }),
          ...(changes.scheduledEnd === undefined
            ? {}
            : { scheduledEnd: changes.scheduledEnd === null ? null : new Date(changes.scheduledEnd) }),
        },
      });

      return tx.block.findFirstOrThrow({
        where: { id: block.id },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
    });

    this.assertScheduleOrder(
      updated.scheduledStart?.toISOString(),
      updated.scheduledEnd?.toISOString(),
    );

    await this.auditService.record({
      organizationId,
      actorId,
      action: "block.updated",
      targetType: "Block",
      targetId: block.id,
      metadata: { pageId, configChanged: sanitized !== null },
    });

    return this.toBlockWithConfig(updated);
  }

  /** Duplicar copia la configuración vigente a un bloque nuevo, justo debajo del original. */
  async duplicateBlock(
    organizationId: string,
    actorId: string,
    siteId: string,
    pageId: string,
    blockId: string,
  ): Promise<BlockWithConfig> {
    const block = await this.getBlockOrThrow(organizationId, siteId, pageId, blockId);

    const created = await this.prisma.$transaction(async (tx) => {
      const currentVersion = await tx.blockVersion.findFirst({
        where: { blockId: block.id },
        orderBy: { versionNumber: "desc" },
      });

      // Se corren una posición los que estaban después, para insertarlo justo debajo.
      await tx.block.updateMany({
        where: { pageId, position: { gt: block.position } },
        data: { position: { increment: 1 } },
      });

      const copy = await tx.block.create({
        data: {
          pageId,
          type: block.type,
          position: block.position + 1,
          configSchemaVersion: block.configSchemaVersion,
          visible: block.visible,
          scheduledStart: block.scheduledStart,
          scheduledEnd: block.scheduledEnd,
        },
      });

      await tx.blockVersion.create({
        data: {
          blockId: copy.id,
          versionNumber: 1,
          config: (currentVersion?.config ?? {}) as PrismaTypes.InputJsonValue,
        },
      });

      return tx.block.findFirstOrThrow({
        where: { id: copy.id },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "block.duplicated",
      targetType: "Block",
      targetId: created.id,
      metadata: { pageId, sourceBlockId: block.id },
    });

    return this.toBlockWithConfig(created);
  }

  async reorderBlocks(
    organizationId: string,
    actorId: string,
    siteId: string,
    pageId: string,
    blockIds: string[],
  ): Promise<BlockWithConfig[]> {
    await this.assertPageInOrganization(organizationId, siteId, pageId);

    if (new Set(blockIds).size !== blockIds.length) {
      throw new BadRequestException("La lista de bloques tiene identificadores repetidos.");
    }

    const current = await this.prisma.block.findMany({ where: { pageId }, select: { id: true } });
    const currentIds = new Set(current.map((block) => block.id));

    if (blockIds.length !== currentIds.size || blockIds.some((id) => !currentIds.has(id))) {
      throw new BadRequestException("La lista debe incluir exactamente todos los bloques de la página.");
    }

    await this.prisma.$transaction(
      blockIds.map((id, index) => this.prisma.block.update({ where: { id }, data: { position: index } })),
    );

    await this.auditService.record({
      organizationId,
      actorId,
      action: "block.reordered",
      targetType: "Page",
      targetId: pageId,
      metadata: { blockIds },
    });

    return this.listBlocks(organizationId, siteId, pageId);
  }

  /**
   * Marca la acción principal de la página (PP5), o la quita con `blockId: null`. Es un cambio del
   * borrador como cualquier otro: el visitante lo ve al publicar.
   *
   * Solo un bloque de acción (`PRIMARY_ACTION_BLOCK_TYPES`) puede serlo, y a lo sumo uno por página.
   * Se desmarca el anterior y se marca el nuevo en la misma transacción; si dos peticiones llegan a
   * la vez, el índice único parcial (`blocks_one_primary_per_page`) rechaza la segunda — la base,
   * no una comprobación previa que la carrera podría saltarse.
   */
  async setPrimaryBlock(
    organizationId: string,
    actorId: string,
    siteId: string,
    pageId: string,
    blockId: string | null,
  ): Promise<BlockWithConfig[]> {
    await this.assertPageInOrganization(organizationId, siteId, pageId);

    if (blockId !== null) {
      // `getBlockOrThrow` filtra por página y organización: un bloque de otra página (o de otra
      // organización) es 404, sin confirmar que existe.
      const block = await this.getBlockOrThrow(organizationId, siteId, pageId, blockId);
      if (!isPrimaryActionBlockType(block.type)) {
        throw new UnprocessableEntityException(
          "Solo un botón de WhatsApp, un enlace o un formulario pueden ser la acción principal.",
        );
      }
    }

    const previous = await this.prisma.block.findFirst({ where: { pageId, isPrimary: true }, select: { id: true } });

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.block.updateMany({ where: { pageId, isPrimary: true }, data: { isPrimary: false } });
        if (blockId !== null) {
          await tx.block.update({ where: { id: blockId }, data: { isPrimary: true } });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Otra persona cambió la acción principal al mismo tiempo. Vuelve a intentarlo.");
      }
      throw error;
    }

    if ((previous?.id ?? null) !== blockId) {
      await this.auditService.record({
        organizationId,
        actorId,
        action: "page.primary_block_set",
        targetType: "Page",
        targetId: pageId,
        metadata: { siteId, blockId, previousBlockId: previous?.id ?? null },
      });
    }

    return this.listBlocks(organizationId, siteId, pageId);
  }

  /**
   * Eliminar un bloque sí borra la fila (y en cascada sus versiones). A diferencia de una página,
   * un bloque suelto no es "trabajo" que el usuario espere recuperar desde la papelera: el
   * historial de la página (F2.6) conserva igual el estado anterior completo, así que la vía de
   * recuperación existe y es la correcta — restaurar una versión de la página.
   */
  async deleteBlock(
    organizationId: string,
    actorId: string,
    siteId: string,
    pageId: string,
    blockId: string,
  ): Promise<void> {
    const block = await this.getBlockOrThrow(organizationId, siteId, pageId, blockId);

    await this.prisma.$transaction(async (tx) => {
      await tx.block.delete({ where: { id: block.id } });
      // Se cierra el hueco de posiciones para que el orden siga siendo 0..n-1.
      await tx.block.updateMany({
        where: { pageId, position: { gt: block.position } },
        data: { position: { decrement: 1 } },
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "block.deleted",
      targetType: "Block",
      targetId: block.id,
      metadata: { pageId, type: block.type },
    });
  }

  private assertScheduleOrder(start?: string, end?: string): void {
    if (start !== undefined && end !== undefined && new Date(start) >= new Date(end)) {
      throw new BadRequestException("La fecha de inicio debe ser anterior a la de término.");
    }
  }
}
