import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PageStatus, Prisma, type PrismaClient } from "@impulza/database";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "../audit/audit.service.js";
import { RevalidateWebService } from "../public-sites/revalidate-web.service.js";
import { pageContentSnapshotSchema, snapshotsEqual, type PageContentSnapshot } from "./page-content-snapshot.js";

/** Resumen de una versión para el historial navegable — sin el snapshot completo (F2.6). */
export interface PageVersionSummary {
  id: string;
  pageId: string;
  versionNumber: number;
  publishedAt: Date;
  createdAt: Date;
  createdBy: { id: string; email: string } | null;
}

/** Una versión completa, con el snapshot — para ver el detalle, publicar o restaurar. */
export interface PageVersionDetail extends PageVersionSummary {
  contentSnapshot: PageContentSnapshot;
}

const CREATED_BY_SELECT = { select: { id: true, email: true } } as const;

@Injectable()
export class PageVersionsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly revalidateWebService: RevalidateWebService,
  ) {}

  /**
   * Valida toda la cadena organización → sitio → página, igual que el resto de los servicios de
   * esta familia (páginas, bloques): cada uno re-verifica la cadena completa en vez de confiar en
   * que otro servicio ya lo hizo, que es lo que de verdad frena el ataque de id cruzado (ADR-002).
   */
  private async getPageOrThrow(organizationId: string, siteId: string, pageId: string) {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, siteId, deletedAt: null, site: { organizationId } },
    });

    if (!page) {
      throw new NotFoundException("Página no encontrada.");
    }

    return page;
  }

  private toSummary(row: {
    id: string;
    pageId: string;
    versionNumber: number;
    publishedAt: Date | null;
    createdAt: Date;
    createdBy: { id: string; email: string } | null;
  }): PageVersionSummary {
    return {
      id: row.id,
      pageId: row.pageId,
      versionNumber: row.versionNumber,
      // Nunca null en la práctica: las únicas dos vías que crean una fila (publicar, restaurar)
      // siempre fijan `publishedAt` en el mismo instante. La columna es nullable en el esquema
      // por si algún día hace falta un camino distinto (ver ERD §3); el contrato de esta API no
      // necesita cargar con esa posibilidad todavía.
      publishedAt: row.publishedAt as Date,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  }

  private toDetail(row: {
    id: string;
    pageId: string;
    versionNumber: number;
    publishedAt: Date | null;
    createdAt: Date;
    createdBy: { id: string; email: string } | null;
    contentSnapshot: Prisma.JsonValue;
  }): PageVersionDetail {
    return {
      ...this.toSummary(row),
      // Se revalida al leer, no solo al escribir: si el formato interno cambiara de forma
      // incompatible, es mejor un 500 explícito acá que devolver un snapshot corrupto al cliente
      // o, peor, usarlo tal cual para reconstruir bloques en un `restore`.
      contentSnapshot: pageContentSnapshotSchema.parse(row.contentSnapshot),
    };
  }

  async listVersions(organizationId: string, siteId: string, pageId: string): Promise<PageVersionSummary[]> {
    await this.getPageOrThrow(organizationId, siteId, pageId);

    const rows = await this.prisma.pageVersion.findMany({
      where: { pageId },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        pageId: true,
        versionNumber: true,
        publishedAt: true,
        createdAt: true,
        createdBy: CREATED_BY_SELECT,
      },
    });

    return rows.map((row) => this.toSummary(row));
  }

  async getVersion(
    organizationId: string,
    siteId: string,
    pageId: string,
    versionId: string,
  ): Promise<PageVersionDetail> {
    await this.getPageOrThrow(organizationId, siteId, pageId);

    // Filtrado por `pageId` y no solo por `id`: sin esto, el id de una versión de otra página (de
    // la misma organización o de otra) sería alcanzable en cuanto alguien adivinara el UUID.
    const row = await this.prisma.pageVersion.findFirst({
      where: { id: versionId, pageId },
      include: { createdBy: CREATED_BY_SELECT },
    });

    if (!row) {
      throw new NotFoundException("Versión no encontrada.");
    }

    return this.toDetail(row);
  }

  /** Arma el snapshot con el estado **vivo** actual de la página y sus bloques. */
  private async buildCandidateSnapshot(
    pageId: string,
    page: { slug: string; visibility: string; seoMeta: Prisma.JsonValue | null },
  ): Promise<PageContentSnapshot> {
    const blocks = await this.prisma.block.findMany({
      where: { pageId },
      orderBy: { position: "asc" },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });

    return pageContentSnapshotSchema.parse({
      slug: page.slug,
      visibility: page.visibility,
      seoMeta: page.seoMeta,
      blocks: blocks.map((block, index) => ({
        id: block.id,
        type: block.type,
        position: index,
        configSchemaVersion: block.configSchemaVersion,
        visible: block.visible,
        scheduledStart: block.scheduledStart?.toISOString() ?? null,
        scheduledEnd: block.scheduledEnd?.toISOString() ?? null,
        config: block.versions[0]?.config ?? null,
      })),
    });
  }

  /**
   * Publica la página: crea un snapshot inmutable del contenido vivo y marca la página como
   * `PUBLISHED`. Editar después de publicar (páginas, bloques) nunca vuelve a tocar esta fila —
   * el público sigue viendo el snapshot hasta la siguiente publicación (F2.6, F2.7).
   *
   * Idempotente: si el contenido no cambió desde la última versión, no crea una fila nueva ni
   * escribe auditoría — devuelve la última versión tal cual. Sin esto, dejar la pestaña de
   * publicar abierta y hacer clic varias veces llenaría el historial de "versiones basura"
   * idénticas entre sí, que es exactamente lo que el criterio de aceptación prohíbe.
   */
  async publishPage(
    organizationId: string,
    actorId: string,
    siteId: string,
    pageId: string,
  ): Promise<PageVersionDetail> {
    const page = await this.getPageOrThrow(organizationId, siteId, pageId);
    const candidate = await this.buildCandidateSnapshot(pageId, page);

    const { versionId, created } = await this.prisma.$transaction(async (tx) => {
      const last = await tx.pageVersion.findFirst({ where: { pageId }, orderBy: { versionNumber: "desc" } });

      if (last && snapshotsEqual(last.contentSnapshot, candidate)) {
        return { versionId: last.id, created: false };
      }

      const version = await tx.pageVersion.create({
        data: {
          pageId,
          versionNumber: (last?.versionNumber ?? 0) + 1,
          contentSnapshot: candidate as Prisma.InputJsonValue,
          publishedAt: new Date(),
          createdById: actorId,
        },
      });

      await tx.page.update({ where: { id: pageId }, data: { status: PageStatus.PUBLISHED } });

      return { versionId: version.id, created: true };
    });

    if (created) {
      const version = await this.prisma.pageVersion.findUniqueOrThrow({ where: { id: versionId } });
      await this.auditService.record({
        organizationId,
        actorId,
        action: "page.published",
        targetType: "Page",
        targetId: pageId,
        metadata: { siteId, versionNumber: version.versionNumber },
      });
      // Solo si de verdad hay algo nuevo que mostrar: si el contenido no cambió, la caché pública
      // ya está sirviendo exactamente esto y no hay nada que invalidar (F2.7).
      await this.revalidateWebService.revalidateSite(siteId);
    }

    return this.getVersion(organizationId, siteId, pageId, versionId);
  }

  /**
   * Restaura una versión anterior: reemplaza el contenido vivo (página + bloques) por el del
   * snapshot elegido y crea una versión **nueva** con ese mismo contenido — nunca reescribe ni
   * borra el historial (F2.6). A diferencia de publicar, restaurar siempre deja una fila nueva:
   * la acción explícita de "volver a esta versión" es en sí misma un evento que vale la pena
   * dejar registrado, incluso en el caso raro en que el contenido resultante coincida con el
   * actual.
   *
   * Todo dentro de una sola transacción: los bloques actuales se reemplazan por completo por los
   * del snapshot (mismo criterio que documenta `BlocksService.deleteBlock` — la papelera de un
   * bloque individual no existe, la vía de recuperación es restaurar la versión de la página), así
   * que un fallo a mitad de camino no puede dejar la página con una mezcla de bloques viejos y
   * nuevos.
   */
  async restoreVersion(
    organizationId: string,
    actorId: string,
    siteId: string,
    pageId: string,
    versionId: string,
  ): Promise<PageVersionDetail> {
    await this.getPageOrThrow(organizationId, siteId, pageId);

    const target = await this.prisma.pageVersion.findFirst({ where: { id: versionId, pageId } });
    if (!target) {
      throw new NotFoundException("Versión no encontrada.");
    }

    const snapshot = pageContentSnapshotSchema.parse(target.contentSnapshot);

    let newVersionId: string;
    try {
      newVersionId = await this.prisma.$transaction(async (tx) => {
        await tx.block.deleteMany({ where: { pageId } });

        for (const [index, block] of snapshot.blocks.entries()) {
          const created = await tx.block.create({
            data: {
              pageId,
              type: block.type,
              position: index,
              configSchemaVersion: block.configSchemaVersion,
              visible: block.visible,
              scheduledStart: block.scheduledStart ? new Date(block.scheduledStart) : null,
              scheduledEnd: block.scheduledEnd ? new Date(block.scheduledEnd) : null,
            },
          });
          await tx.blockVersion.create({
            data: {
              blockId: created.id,
              versionNumber: 1,
              // `?? {}` y no `null`: BlockVersion.config es Json NO nulo. Mismo criterio defensivo que
              // `BlocksService.duplicateBlock` para el mismo campo.
              config: (block.config ?? {}) as Prisma.InputJsonValue,
            },
          });
        }

        await tx.page.update({
          where: { id: pageId },
          data: {
            slug: snapshot.slug,
            visibility: snapshot.visibility,
            // Page.seoMeta sí es nullable: `null` llano no alcanza para pedirle a Prisma "columna en
            // NULL" en un campo Json — hace falta el centinela `Prisma.DbNull`.
            seoMeta: snapshot.seoMeta === null ? Prisma.DbNull : (snapshot.seoMeta as Prisma.InputJsonValue),
            status: PageStatus.PUBLISHED,
          },
        });

        const last = await tx.pageVersion.findFirst({ where: { pageId }, orderBy: { versionNumber: "desc" } });

        const version = await tx.pageVersion.create({
          data: {
            pageId,
            versionNumber: (last?.versionNumber ?? 0) + 1,
            // El contenido resultante es, por definición, exactamente el del snapshot restaurado
            // — no hace falta reconstruirlo leyendo lo que se acaba de escribir.
            contentSnapshot: target.contentSnapshot as Prisma.InputJsonValue,
            publishedAt: new Date(),
            createdById: actorId,
          },
        });

        return version.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          "Otra página del sitio ya usa el slug de esa versión. Renómbrala antes de restaurar esta.",
        );
      }
      throw error;
    }

    const newVersion = await this.prisma.pageVersion.findUniqueOrThrow({ where: { id: newVersionId } });
    await this.auditService.record({
      organizationId,
      actorId,
      action: "page.version_restored",
      targetType: "Page",
      targetId: pageId,
      metadata: { siteId, restoredFromVersion: target.versionNumber, newVersion: newVersion.versionNumber },
    });
    // Restaurar siempre reemplaza el contenido vivo, así que siempre hay algo nuevo que mostrar
    // (F2.7) — a diferencia de publicar, acá no hay caso idempotente que saltarse.
    await this.revalidateWebService.revalidateSite(siteId);

    return this.getVersion(organizationId, siteId, pageId, newVersionId);
  }
}
