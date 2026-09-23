import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Prisma as PrismaTypes, type PrismaClient, type ShortLink } from "@impulza/database";
import type { CreateShortLinkInput, UpdateShortLinkInput } from "@impulza/validation";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";

const SLUG_TAKEN = "Ya existe un enlace corto con ese slug.";

@Injectable()
export class ShortLinksService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async list(organizationId: string): Promise<ShortLink[]> {
    return this.prisma.shortLink.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

  private async getOrThrow(organizationId: string, shortLinkId: string): Promise<ShortLink> {
    const link = await this.prisma.shortLink.findFirst({ where: { id: shortLinkId, organizationId } });
    if (!link) {
      throw new NotFoundException("Enlace corto no encontrado.");
    }
    return link;
  }

  async get(organizationId: string, shortLinkId: string): Promise<ShortLink> {
    return this.getOrThrow(organizationId, shortLinkId);
  }

  async create(organizationId: string, actorId: string, input: CreateShortLinkInput): Promise<ShortLink> {
    let created: ShortLink;
    try {
      created = await this.prisma.shortLink.create({
        data: {
          organizationId,
          slug: input.slug,
          destinationUrl: input.destinationUrl,
          utm: (input.utm ?? null) as PrismaTypes.InputJsonValue,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(SLUG_TAKEN);
      }
      throw error;
    }

    await this.auditService.record({
      organizationId,
      actorId,
      action: "short_link.created",
      targetType: "ShortLink",
      targetId: created.id,
      metadata: { slug: created.slug, destinationUrl: created.destinationUrl },
    });

    return created;
  }

  async update(
    organizationId: string,
    actorId: string,
    shortLinkId: string,
    changes: UpdateShortLinkInput,
  ): Promise<ShortLink> {
    const link = await this.getOrThrow(organizationId, shortLinkId);

    const updated = await this.prisma.shortLink.update({
      where: { id: link.id },
      data: {
        ...(changes.destinationUrl === undefined ? {} : { destinationUrl: changes.destinationUrl }),
        ...(changes.utm === undefined
          ? {}
          : { utm: (changes.utm === null ? null : changes.utm) as PrismaTypes.InputJsonValue }),
      },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "short_link.updated",
      targetType: "ShortLink",
      targetId: link.id,
      metadata: changes,
    });

    return updated;
  }

  /**
   * Borrado real: un `QrCode` que dependa solo de este enlace lo bloquea (F3.1, `NoAction`) — el
   * usuario tiene que borrar o reasignar el QR primero, no un huérfano silencioso.
   */
  async delete(organizationId: string, actorId: string, shortLinkId: string): Promise<void> {
    const link = await this.getOrThrow(organizationId, shortLinkId);

    try {
      await this.prisma.shortLink.delete({ where: { id: link.id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException(
          "Este enlace tiene un código QR propio. Bórralo o dale una URL directa antes de borrar el enlace.",
        );
      }
      throw error;
    }

    await this.auditService.record({
      organizationId,
      actorId,
      action: "short_link.deleted",
      targetType: "ShortLink",
      targetId: link.id,
      metadata: { slug: link.slug },
    });
  }
}
