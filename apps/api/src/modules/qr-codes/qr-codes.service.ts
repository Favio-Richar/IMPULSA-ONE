import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma as PrismaTypes, PrismaClient, QrCode } from "@impulza/database";
import { getQrStylePreset, type CreateQrCodeInput, type UpdateQrCodeInput } from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";

@Injectable()
export class QrCodesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  async list(organizationId: string): Promise<QrCode[]> {
    return this.prisma.qrCode.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

  private async getOrThrow(organizationId: string, qrCodeId: string): Promise<QrCode> {
    const qrCode = await this.prisma.qrCode.findFirst({ where: { id: qrCodeId, organizationId } });
    if (!qrCode) {
      throw new NotFoundException("Código QR no encontrado.");
    }
    return qrCode;
  }

  async get(organizationId: string, qrCodeId: string): Promise<QrCode> {
    return this.getOrThrow(organizationId, qrCodeId);
  }

  async create(organizationId: string, actorId: string, input: CreateQrCodeInput): Promise<QrCode> {
    if (input.shortLinkId) {
      const link = await this.prisma.shortLink.findFirst({
        where: { id: input.shortLinkId, organizationId },
        select: { id: true },
      });
      if (!link) {
        throw new NotFoundException("Enlace corto no encontrado.");
      }
    }

    const preset = getQrStylePreset(input.styleKey);
    if (!preset) {
      throw new BadRequestException("Estilo de QR no reconocido.");
    }

    const created = await this.prisma.qrCode.create({
      data: {
        organizationId,
        shortLinkId: input.shortLinkId ?? null,
        directUrl: input.directUrl ?? null,
        styleConfig: preset as unknown as PrismaTypes.InputJsonValue,
      },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "qr_code.created",
      targetType: "QrCode",
      targetId: created.id,
      metadata: { shortLinkId: input.shortLinkId ?? null, directUrl: input.directUrl ?? null },
    });

    return created;
  }

  async update(organizationId: string, actorId: string, qrCodeId: string, changes: UpdateQrCodeInput): Promise<QrCode> {
    const qrCode = await this.getOrThrow(organizationId, qrCodeId);

    let styleConfig: PrismaTypes.InputJsonValue | undefined;
    if (changes.styleKey !== undefined) {
      const preset = getQrStylePreset(changes.styleKey);
      if (!preset) {
        throw new BadRequestException("Estilo de QR no reconocido.");
      }
      styleConfig = preset as unknown as PrismaTypes.InputJsonValue;
    }

    const updated = await this.prisma.qrCode.update({
      where: { id: qrCode.id },
      data: { ...(styleConfig === undefined ? {} : { styleConfig }) },
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "qr_code.updated",
      targetType: "QrCode",
      targetId: qrCode.id,
      metadata: changes,
    });

    return updated;
  }

  async delete(organizationId: string, actorId: string, qrCodeId: string): Promise<void> {
    const qrCode = await this.getOrThrow(organizationId, qrCodeId);

    await this.prisma.qrCode.delete({ where: { id: qrCode.id } });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "qr_code.deleted",
      targetType: "QrCode",
      targetId: qrCode.id,
      metadata: {},
    });
  }
}
