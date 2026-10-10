import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MembershipStatus, PERMISSIONS, Prisma, PublishRequestKind, PublishRequestStatus, type PrismaClient } from "@impulza/database";
import type { EmailAdapter } from "@impulza/auth";
import type {
  PagePublishStatusResponse,
  PublishRequestDetailResponse,
  PublishRequestListResponse,
  PublishRequestSummaryResponse,
  PublishSettingsResponse,
} from "@impulza/contracts";
import {
  publishGate,
  reviewVerdict,
  type ApprovePublishRequestDto,
  type CreatePublishRequestDto,
  type PublishRequestListQuery,
  type RejectPublishRequestDto,
} from "@impulza/validation";
import { env } from "../../env.js";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { EMAIL_ADAPTER } from "../auth/email-adapter.token.js";
import { permissionsOfMembership } from "../organizations/team-permissions.js";
import {
  buildLiveSnapshot,
  pageContentSnapshotSchema,
  snapshotDigest,
  snapshotsEqual,
  type PageContentSnapshot,
} from "./page-content-snapshot.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Lo que hace falta de la membresía de quien actúa para saber qué puede hacer: su rol y, si lo tiene, el personalizado. */
export interface ActorMembership {
  id: string;
  roleId: string;
  customRoleId: string | null;
}

const REQUEST_INCLUDE = {
  page: { select: { id: true, slug: true, siteId: true, deletedAt: true, site: { select: { name: true } } } },
  requestedBy: { select: { id: true, email: true } },
  reviewedBy: { select: { id: true, email: true } },
  targetVersion: { select: { versionNumber: true } },
  publishedVersion: { select: { versionNumber: true } },
} satisfies Prisma.PublishRequestInclude;

type RequestRow = Prisma.PublishRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;
/** Lo que se necesita para resumir una solicitud: no carga el contenido completo (puede ser grande). */
type SummaryRow = Omit<RequestRow, "contentSnapshot">;
const WITHOUT_CONTENT = { contentSnapshot: true } as const;

function toSummary(row: SummaryRow): PublishRequestSummaryResponse {
  return {
    id: row.id,
    pageId: row.pageId,
    pageSlug: row.page.slug,
    siteId: row.page.siteId,
    siteName: row.page.site.name,
    kind: row.kind,
    targetVersionNumber: row.targetVersion?.versionNumber ?? null,
    status: row.status,
    requestedBy: row.requestedBy,
    requestComment: row.requestComment,
    reviewedBy: row.reviewedBy,
    reviewComment: row.reviewComment,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    consumedAt: row.consumedAt?.toISOString() ?? null,
    publishedVersionNumber: row.publishedVersion?.versionNumber ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function forbid(code: string, message: string): never {
  throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code, message });
}

function conflict(code: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new ConflictException({ statusCode: 409, error: "Conflict", code, message, ...extra });
}

/**
 * Aprobación antes de publicar (F9.6c, ADR-028 §3). Reglas que se aplican aquí, en el servidor:
 * - con la opción activa, publicar o restaurar exige una solicitud APROBADA cuyo contenido coincide con el que se publicaría ahora
 *   (si se editó después de aprobar, hay que pedir de nuevo); la aprobación se usa una sola vez;
 * - quien tiene `publish.approve` publica directo; quien no, pide y espera;
 * - nadie aprueba ni rechaza su propia solicitud;
 * - activar o desactivar la opción es solo de `publish.configure` (el propietario) y una agencia delegada no llega a ella;
 * - cada paso queda en la auditoría y avisa por correo.
 */
@Injectable()
export class PublishApprovalService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
  ) {}

  // ---- la compuerta (la usan publicar y restaurar) -----------------------------------------------------------------

  /** ¿La organización exige aprobación y quien actúa no puede aprobar? Entonces necesita una solicitud aprobada. */
  async needsApproval(db: Db, organizationId: string, membership: ActorMembership): Promise<boolean> {
    const { requireApproval, canApprove } = await this.gateInputs(db, organizationId, membership);
    return publishGate({ requireApproval, actorCanApprove: canApprove }).mode === "NEEDS_APPROVAL";
  }

  private async gateInputs(db: Db, organizationId: string, membership: ActorMembership) {
    const [organization, permissions] = await Promise.all([
      db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { requirePublishApproval: true } }),
      permissionsOfMembership(db, membership),
    ]);
    return {
      requireApproval: organization.requirePublishApproval,
      canApprove: permissions.includes(PERMISSIONS.PUBLISH_APPROVE),
      canConfigure: permissions.includes(PERMISSIONS.PUBLISH_CONFIGURE),
    };
  }

  /**
   * Busca la aprobación que habilita esta publicación y la **marca como usada en la misma transacción** que crea la versión. Sin una
   * aprobación vigente responde 403 (`PUBLISH_APPROVAL_REQUIRED`, o `PUBLISH_APPROVAL_OUTDATED` si hubo una aprobación pero el contenido
   * cambió después). Devuelve el id para cerrarla con la versión creada (`markConsumed`).
   */
  async findApprovalFor(
    tx: Prisma.TransactionClient,
    input: { organizationId: string; pageId: string; kind: "PUBLISH" | "RESTORE"; digest: string; targetVersionId: string | null },
  ): Promise<string> {
    const approved = await tx.publishRequest.findMany({
      where: {
        organizationId: input.organizationId,
        pageId: input.pageId,
        kind: input.kind,
        status: PublishRequestStatus.APPROVED,
        consumedAt: null,
        ...(input.kind === "RESTORE" ? { targetVersionId: input.targetVersionId } : {}),
      },
      orderBy: { reviewedAt: "desc" },
      select: { id: true, contentDigest: true },
    });
    const match = approved.find((request) => request.contentDigest === input.digest);
    if (match) return match.id;
    if (approved.length > 0) {
      forbid("PUBLISH_APPROVAL_OUTDATED", "El contenido cambió después de que lo aprobaran: pide la aprobación de nuevo.");
    }
    return forbid("PUBLISH_APPROVAL_REQUIRED", "Esta organización exige aprobación antes de publicar: pídela y espera a que la aprueben.");
  }

  async markConsumed(tx: Prisma.TransactionClient, requestId: string, publishedVersionId: string): Promise<void> {
    const { count } = await tx.publishRequest.updateMany({
      where: { id: requestId, status: PublishRequestStatus.APPROVED, consumedAt: null },
      data: { consumedAt: new Date(), publishedVersionId },
    });
    // Otra publicación usó esta misma aprobación un instante antes: esta se deshace entera.
    if (count !== 1) {
      conflict("PUBLISH_APPROVAL_USED", "Esa aprobación ya se usó: pide otra si hay cambios nuevos.");
    }
  }

  // ---- opción de la organización -----------------------------------------------------------------------------------

  async getSettings(organizationId: string, membership: ActorMembership): Promise<PublishSettingsResponse> {
    const { requireApproval, canConfigure, canApprove } = await this.gateInputs(this.prisma, organizationId, membership);
    return { requireApproval, canConfigure, canApprove };
  }

  async updateSettings(organizationId: string, actorId: string, membership: ActorMembership, requireApproval: boolean): Promise<PublishSettingsResponse> {
    const { before, cancelled } = await this.prisma.$transaction(async (tx) => {
      const current = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { requirePublishApproval: true } });
      await tx.organization.update({ where: { id: organizationId }, data: { requirePublishApproval: requireApproval } });
      let count = 0;
      if (!requireApproval) {
        // Sin compuerta una solicitud pendiente ya no tiene sentido: quien la pidió puede publicar directo.
        const result = await tx.publishRequest.updateMany({
          where: { organizationId, status: PublishRequestStatus.PENDING },
          data: { status: PublishRequestStatus.CANCELLED, reviewComment: "Se desactivó la aprobación antes de publicar.", reviewedAt: new Date() },
        });
        count = result.count;
      }
      return { before: current.requirePublishApproval, cancelled: count };
    });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "publish_settings.updated",
      targetType: "Organization",
      targetId: organizationId,
      metadata: { requireApproval, previous: before, cancelledPending: cancelled },
    });
    return this.getSettings(organizationId, membership);
  }

  // ---- solicitudes -------------------------------------------------------------------------------------------------

  private async getPageOrThrow(organizationId: string, siteId: string, pageId: string) {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, siteId, deletedAt: null, site: { organizationId } },
      select: { id: true, slug: true, visibility: true, seoMeta: true, siteId: true, site: { select: { name: true } } },
    });
    if (!page) throw new NotFoundException("Página no encontrada.");
    return page;
  }

  private async getRequestOrThrow(organizationId: string, requestId: string): Promise<SummaryRow> {
    // Filtrada por organización: el id de una solicitud de otra organización es un 404, no un 403 (ADR-002).
    const row = await this.prisma.publishRequest.findFirst({ where: { id: requestId, organizationId }, include: REQUEST_INCLUDE, omit: WITHOUT_CONTENT });
    if (!row) throw new NotFoundException("Solicitud no encontrada.");
    return row;
  }

  async create(
    organizationId: string,
    actorId: string,
    membership: ActorMembership,
    siteId: string,
    pageId: string,
    dto: CreatePublishRequestDto,
  ): Promise<PublishRequestSummaryResponse> {
    const page = await this.getPageOrThrow(organizationId, siteId, pageId);
    const { requireApproval, canApprove } = await this.gateInputs(this.prisma, organizationId, membership);
    if (!requireApproval) {
      conflict("APPROVAL_NOT_REQUIRED", "Esta organización no exige aprobación: puedes publicar directamente.");
    }
    if (canApprove) {
      conflict("CAN_PUBLISH_DIRECTLY", "Tienes permiso para aprobar: publica directamente, no necesitas pedirlo.");
    }

    let snapshot: PageContentSnapshot;
    let targetVersionId: string | null = null;
    if (dto.kind === "RESTORE") {
      const target = await this.prisma.pageVersion.findFirst({ where: { id: dto.versionId!, pageId } });
      if (!target) throw new NotFoundException("Versión no encontrada.");
      snapshot = pageContentSnapshotSchema.parse(target.contentSnapshot);
      targetVersionId = target.id;
    } else {
      snapshot = await buildLiveSnapshot(this.prisma, pageId, page);
      const last = await this.prisma.pageVersion.findFirst({ where: { pageId }, orderBy: { versionNumber: "desc" } });
      if (last && snapshotsEqual(last.contentSnapshot, snapshot)) {
        conflict("NOTHING_TO_PUBLISH", "No hay cambios sin publicar en esta página.");
      }
    }
    const digest = snapshotDigest(snapshot);

    const created = await this.prisma.$transaction(async (tx) => {
      // Una pendiente por página: dos peticiones a la vez no crean dos.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`publish-request:${pageId}`}, 0))`;

      const alreadyApproved = await tx.publishRequest.findFirst({
        where: { pageId, status: PublishRequestStatus.APPROVED, consumedAt: null, kind: dto.kind, contentDigest: digest, targetVersionId },
        select: { id: true },
      });
      if (alreadyApproved) {
        conflict("ALREADY_APPROVED", "Esto ya está aprobado: solo falta publicarlo.", { requestId: alreadyApproved.id });
      }

      const pending = await tx.publishRequest.findFirst({ where: { pageId, status: PublishRequestStatus.PENDING } });
      if (pending) {
        if (pending.contentDigest === digest && pending.kind === dto.kind && pending.targetVersionId === targetVersionId) {
          conflict("ALREADY_PENDING", "Ya hay una solicitud pendiente para este contenido.", { requestId: pending.id });
        }
        // Cambió el contenido (o lo que se pide): la anterior ya no describe nada y la reemplaza la nueva.
        await tx.publishRequest.update({
          where: { id: pending.id },
          data: { status: PublishRequestStatus.CANCELLED, reviewComment: "Reemplazada por una solicitud nueva.", reviewedAt: new Date() },
        });
      }

      return tx.publishRequest.create({
        data: {
          organizationId,
          pageId,
          kind: dto.kind === "RESTORE" ? PublishRequestKind.RESTORE : PublishRequestKind.PUBLISH,
          targetVersionId,
          contentDigest: digest,
          contentSnapshot: snapshot as Prisma.InputJsonValue,
          requestedById: actorId,
          requestComment: dto.comment,
        },
        include: REQUEST_INCLUDE,
      });
    });

    await this.auditService.record({
      organizationId,
      actorId,
      action: "publish_request.created",
      targetType: "PublishRequest",
      targetId: created.id,
      metadata: { pageId, siteId, kind: dto.kind, targetVersionId },
    });
    await this.notifyApprovers(organizationId, actorId, created);
    return toSummary(created);
  }

  async approve(organizationId: string, actorId: string, requestId: string, dto: ApprovePublishRequestDto): Promise<PublishRequestSummaryResponse> {
    return this.review(organizationId, actorId, requestId, PublishRequestStatus.APPROVED, dto.comment);
  }

  async reject(organizationId: string, actorId: string, requestId: string, dto: RejectPublishRequestDto): Promise<PublishRequestSummaryResponse> {
    return this.review(organizationId, actorId, requestId, PublishRequestStatus.REJECTED, dto.comment);
  }

  private async review(
    organizationId: string,
    actorId: string,
    requestId: string,
    outcome: "APPROVED" | "REJECTED",
    comment: string | null,
  ): Promise<PublishRequestSummaryResponse> {
    const existing = await this.getRequestOrThrow(organizationId, requestId);
    const verdict = reviewVerdict({ actorId, requestedById: existing.requestedById, status: existing.status });
    if (!verdict.allowed) {
      if (verdict.code === "NOT_PENDING") conflict(verdict.code, verdict.message);
      forbid(verdict.code, verdict.message);
    }
    if (outcome === "APPROVED" && existing.page.deletedAt !== null) {
      conflict("PAGE_DELETED", "La página está en la papelera: no se puede aprobar su publicación.");
    }

    // Atómico: si otra persona la resolvió un instante antes, esta no la pisa.
    const { count } = await this.prisma.publishRequest.updateMany({
      where: { id: existing.id, organizationId, status: PublishRequestStatus.PENDING },
      data: { status: outcome, reviewedById: actorId, reviewComment: comment, reviewedAt: new Date() },
    });
    if (count !== 1) conflict("NOT_PENDING", "Esta solicitud ya fue resuelta.");

    await this.auditService.record({
      organizationId,
      actorId,
      action: outcome === "APPROVED" ? "publish_request.approved" : "publish_request.rejected",
      targetType: "PublishRequest",
      targetId: existing.id,
      metadata: { pageId: existing.pageId, kind: existing.kind, requestedById: existing.requestedById, hasComment: comment !== null },
    });
    const updated = await this.getRequestOrThrow(organizationId, requestId);
    await this.notifyRequester(updated);
    return toSummary(updated);
  }

  async cancel(organizationId: string, actorId: string, requestId: string): Promise<PublishRequestSummaryResponse> {
    const existing = await this.getRequestOrThrow(organizationId, requestId);
    if (existing.requestedById !== actorId) {
      forbid("NOT_REQUESTER", "Solo quien pidió la publicación puede cancelar su solicitud.");
    }
    const { count } = await this.prisma.publishRequest.updateMany({
      where: { id: existing.id, organizationId, status: PublishRequestStatus.PENDING },
      data: { status: PublishRequestStatus.CANCELLED, reviewedAt: new Date() },
    });
    if (count !== 1) conflict("NOT_PENDING", "Esta solicitud ya fue resuelta.");
    await this.auditService.record({
      organizationId,
      actorId,
      action: "publish_request.cancelled",
      targetType: "PublishRequest",
      targetId: existing.id,
      metadata: { pageId: existing.pageId, kind: existing.kind },
    });
    return toSummary(await this.getRequestOrThrow(organizationId, requestId));
  }

  // ---- lectura -----------------------------------------------------------------------------------------------------

  async list(organizationId: string, query: PublishRequestListQuery): Promise<PublishRequestListResponse> {
    const where: Prisma.PublishRequestWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.pageId ? { pageId: query.pageId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.publishRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        omit: WITHOUT_CONTENT,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.publishRequest.count({ where }),
    ]);
    return { items: rows.map(toSummary), total, limit: query.limit, offset: query.offset };
  }

  async detail(organizationId: string, requestId: string): Promise<PublishRequestDetailResponse> {
    const row = await this.prisma.publishRequest.findFirst({ where: { id: requestId, organizationId }, include: REQUEST_INCLUDE });
    if (!row) throw new NotFoundException("Solicitud no encontrada.");
    const snapshot = pageContentSnapshotSchema.parse(row.contentSnapshot);
    let contentIsCurrent: boolean | null = null;
    if (row.kind === PublishRequestKind.PUBLISH && row.page.deletedAt === null) {
      const page = await this.prisma.page.findUnique({ where: { id: row.pageId }, select: { slug: true, visibility: true, seoMeta: true } });
      if (page) contentIsCurrent = snapshotDigest(await buildLiveSnapshot(this.prisma, row.pageId, page)) === row.contentDigest;
    }
    return {
      ...toSummary(row),
      content: {
        slug: snapshot.slug,
        visibility: snapshot.visibility,
        seoMeta: snapshot.seoMeta,
        blocks: snapshot.blocks.map((block) => ({ type: block.type, position: block.position, visible: block.visible, config: block.config })),
      },
      contentIsCurrent,
    };
  }

  async status(organizationId: string, siteId: string, pageId: string, membership: ActorMembership): Promise<PagePublishStatusResponse> {
    const page = await this.getPageOrThrow(organizationId, siteId, pageId);
    const { requireApproval, canApprove } = await this.gateInputs(this.prisma, organizationId, membership);
    const liveDigest = snapshotDigest(await buildLiveSnapshot(this.prisma, pageId, page));

    const [pending, approvedRows, lastResolved] = await Promise.all([
      this.prisma.publishRequest.findFirst({ where: { pageId, status: PublishRequestStatus.PENDING }, include: REQUEST_INCLUDE, omit: WITHOUT_CONTENT }),
      this.prisma.publishRequest.findMany({
        where: { pageId, status: PublishRequestStatus.APPROVED, consumedAt: null },
        include: REQUEST_INCLUDE,
        omit: WITHOUT_CONTENT,
        orderBy: { reviewedAt: "desc" },
        take: 50,
      }),
      this.prisma.publishRequest.findFirst({
        where: { pageId, status: { not: PublishRequestStatus.PENDING } },
        include: REQUEST_INCLUDE,
        omit: WITHOUT_CONTENT,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
    ]);

    // Solo sirven las aprobaciones que hoy habilitarían publicar: la de publicar exige el mismo contenido vivo.
    const usable = approvedRows.filter((row) => (row.kind === PublishRequestKind.PUBLISH ? row.contentDigest === liveDigest : row.targetVersionId !== null));
    return {
      approvalRequired: requireApproval,
      canPublishDirectly: publishGate({ requireApproval, actorCanApprove: canApprove }).mode === "DIRECT",
      canApprove,
      pending: pending ? toSummary(pending) : null,
      approved: usable.map(toSummary),
      lastResolved: lastResolved ? toSummary(lastResolved) : null,
    };
  }

  // ---- avisos por correo (solo consola hasta que haya proveedor real; un fallo nunca rompe la acción) -------------------

  private async notifyApprovers(organizationId: string, requesterId: string, request: SummaryRow): Promise<void> {
    try {
      const approvers = await this.prisma.membership.findMany({
        where: {
          organizationId,
          status: MembershipStatus.ACTIVE,
          userId: { not: requesterId },
          OR: [
            { customRoleId: null, role: { permissions: { some: { permission: { key: PERMISSIONS.PUBLISH_APPROVE } } } } },
            { customRole: { permissions: { some: { permission: { key: PERMISSIONS.PUBLISH_APPROVE } } } } },
          ],
        },
        select: { user: { select: { email: true } } },
      });
      const who = request.requestedBy?.email ?? "Una persona del equipo";
      const what = request.kind === PublishRequestKind.RESTORE ? "volver a una versión anterior de" : "publicar";
      const text =
        `${who} pide ${what} la página «${request.page.slug}» del sitio «${request.page.site.name}».\n` +
        (request.requestComment ? `\nComentario: ${request.requestComment}\n` : "") +
        `\nRevísala y apruébala o recházala en: ${env.APP_BASE_URL.replace(/\/$/, "")}/aprobaciones`;
      for (const approver of approvers) {
        await this.email.send({ to: approver.user.email, subject: `Solicitud de publicación: ${request.page.slug}`, text });
      }
    } catch (error) {
      logger.error("publish-approval: no se pudo avisar a quienes aprueban", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async notifyRequester(request: SummaryRow): Promise<void> {
    if (!request.requestedBy) return;
    try {
      const approved = request.status === PublishRequestStatus.APPROVED;
      const text =
        (approved
          ? `Tu solicitud para la página «${request.page.slug}» fue aprobada. Ya puedes publicarla desde el editor.`
          : `Tu solicitud para la página «${request.page.slug}» fue rechazada.`) +
        (request.reviewComment ? `\n\nComentario: ${request.reviewComment}` : "");
      await this.email.send({
        to: request.requestedBy.email,
        subject: approved ? `Aprobada: ${request.page.slug}` : `Rechazada: ${request.page.slug}`,
        text,
      });
    } catch (error) {
      logger.error("publish-approval: no se pudo avisar a quien pidió", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
