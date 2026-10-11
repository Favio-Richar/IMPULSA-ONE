import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { OrganizationKind, type Prisma, type PrismaClient } from "@impulza/database";
import { loadMemberScope } from "@impulza/agency";
import type { AuditEntryResponse, AuditListResponse } from "@impulza/contracts";
import {
  AUDIT_EXPORT_MAX_ROWS,
  auditDateBounds,
  auditMetadataText,
  scopeAllowsClient,
  toCsv,
  type AuditExportQuery,
  type AuditQuery,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { AuditService } from "./audit.service.js";

const ROW_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  metadata: true,
  createdAt: true,
  actor: { select: { id: true, email: true } },
  organization: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogSelect;

type Row = Prisma.AuditLogGetPayload<{ select: typeof ROW_SELECT }>;
type Filters = Pick<AuditQuery, "actor" | "action" | "targetType" | "from" | "to">;

interface Delegation {
  agencyOrganizationId: string;
}

function delegationOf(metadata: Prisma.JsonValue | null): { delegation: Delegation | null; rest: Record<string, unknown> | null } {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return { delegation: null, rest: null };
  const { delegatedBy, ...rest } = metadata as Record<string, unknown>;
  const agencyId = (delegatedBy as { agencyOrganizationId?: unknown } | undefined)?.agencyOrganizationId;
  return {
    delegation: typeof agencyId === "string" ? { agencyOrganizationId: agencyId } : null,
    rest: Object.keys(rest).length > 0 ? rest : null,
  };
}

/**
 * Auditoría navegable (F9.6d, ADR-028 §3). Reglas que se aplican aquí, en el servidor:
 * - una organización solo ve SU auditoría; una agencia solo ve las acciones que SU equipo hizo en sus clientes (la marca de delegación),
 *   nunca lo que el cliente hace por su cuenta, y una persona acotada a ciertos clientes (F9.6b) solo ve esos;
 * - los filtros llegan validados; el recuento y la página se calculan en la base, no en memoria;
 * - la exportación sale por `toCsv` (celdas neutralizadas), con tope de filas, y exportar queda registrado en la auditoría.
 */
@Injectable()
export class AuditQueryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
  ) {}

  // ---- organización ------------------------------------------------------------------------------------------------

  async listForOrganization(organizationId: string, query: AuditQuery): Promise<AuditListResponse> {
    if (query.client !== undefined) {
      throw new BadRequestException("El filtro `client` solo existe en la auditoría de una agencia.");
    }
    return this.page({ organizationId }, query);
  }

  async exportForOrganization(organizationId: string, actorId: string, query: AuditExportQuery): Promise<string> {
    if (query.client !== undefined) {
      throw new BadRequestException("El filtro `client` solo existe en la auditoría de una agencia.");
    }
    return this.exportCsv({ organizationId }, organizationId, actorId, "organization", query);
  }

  // ---- agencia -----------------------------------------------------------------------------------------------------

  /** Lo que una agencia puede ver: acciones delegadas suyas, en clientes a los que esta persona tiene acceso. */
  private async agencyBase(agencyOrganizationId: string, userId: string, client: string | undefined): Promise<Prisma.AuditLogWhereInput> {
    const agency = await this.prisma.organization.findUniqueOrThrow({ where: { id: agencyOrganizationId }, select: { kind: true } });
    if (agency.kind !== OrganizationKind.AGENCY) {
      throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code: "NOT_AN_AGENCY", message: "Esta organización no es una agencia." });
    }
    const [relations, scope] = await Promise.all([
      this.prisma.agencyClient.findMany({ where: { agencyOrganizationId }, select: { id: true, clientOrganizationId: true } }),
      loadMemberScope(this.prisma, agencyOrganizationId, userId),
    ]);
    const visible = relations.filter((relation) => scopeAllowsClient(scope, relation.id));
    const organizationIds = visible.map((relation) => relation.clientOrganizationId);
    if (client !== undefined && !organizationIds.includes(client)) {
      // Un cliente ajeno, o de la agencia pero fuera del alcance de esta persona, responde igual que uno que no existe.
      throw new NotFoundException("Cliente no encontrado.");
    }
    return {
      organizationId: { in: client !== undefined ? [client] : organizationIds },
      metadata: { path: ["delegatedBy", "agencyOrganizationId"], equals: agencyOrganizationId },
    };
  }

  async listForAgency(agencyOrganizationId: string, userId: string, query: AuditQuery): Promise<AuditListResponse> {
    return this.page(await this.agencyBase(agencyOrganizationId, userId, query.client), query);
  }

  async exportForAgency(agencyOrganizationId: string, userId: string, query: AuditExportQuery): Promise<string> {
    const base = await this.agencyBase(agencyOrganizationId, userId, query.client);
    return this.exportCsv(base, agencyOrganizationId, userId, "agency", query);
  }

  // ---- comunes -----------------------------------------------------------------------------------------------------

  private where(base: Prisma.AuditLogWhereInput, filters: Filters): Prisma.AuditLogWhereInput {
    const bounds = auditDateBounds(filters);
    const and: Prisma.AuditLogWhereInput[] = [base];
    if (filters.action) and.push({ action: { startsWith: filters.action } });
    if (filters.targetType) and.push({ targetType: filters.targetType });
    if (filters.actor) and.push({ actor: { email: { contains: filters.actor, mode: "insensitive" } } });
    if (bounds.gte || bounds.lt) and.push({ createdAt: { ...(bounds.gte ? { gte: bounds.gte } : {}), ...(bounds.lt ? { lt: bounds.lt } : {}) } });
    return { AND: and };
  }

  private async agencyNames(rows: Row[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.flatMap((row) => delegationOf(row.metadata).delegation?.agencyOrganizationId ?? []))];
    if (ids.length === 0) return new Map();
    const agencies = await this.prisma.organization.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(agencies.map((agency) => [agency.id, agency.name]));
  }

  private toEntry(row: Row, names: Map<string, string>): AuditEntryResponse {
    const { delegation, rest } = delegationOf(row.metadata);
    return {
      id: row.id,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      actor: row.actor,
      organization: row.organization,
      delegatedBy: delegation ? { agencyOrganizationId: delegation.agencyOrganizationId, agencyName: names.get(delegation.agencyOrganizationId) ?? null } : null,
      metadata: rest,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async page(base: Prisma.AuditLogWhereInput, query: AuditQuery): Promise<AuditListResponse> {
    const where = this.where(base, query);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, select: ROW_SELECT, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: query.limit, skip: query.offset }),
      this.prisma.auditLog.count({ where }),
    ]);
    const names = await this.agencyNames(rows);
    return { items: rows.map((row) => this.toEntry(row, names)), total, limit: query.limit, offset: query.offset };
  }

  private async exportCsv(
    base: Prisma.AuditLogWhereInput,
    organizationId: string,
    actorId: string,
    view: "organization" | "agency",
    query: AuditExportQuery,
  ): Promise<string> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.where(base, query),
      select: ROW_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: AUDIT_EXPORT_MAX_ROWS + 1,
    });
    const truncated = rows.length > AUDIT_EXPORT_MAX_ROWS;
    const kept = truncated ? rows.slice(0, AUDIT_EXPORT_MAX_ROWS) : rows;
    const names = await this.agencyNames(kept);

    const table: Array<Array<string | number | null>> = [
      ["Fecha (UTC)", "Acción", "Persona", "Recurso", "Id del recurso", "Organización", "Vía agencia", "Detalle"],
      ...kept.map((row) => {
        const entry = this.toEntry(row, names);
        return [
          entry.createdAt,
          entry.action,
          entry.actor?.email ?? "",
          entry.targetType,
          entry.targetId ?? "",
          entry.organization?.name ?? "",
          entry.delegatedBy ? (entry.delegatedBy.agencyName ?? entry.delegatedBy.agencyOrganizationId) : "",
          auditMetadataText(entry.metadata),
        ];
      }),
    ];
    if (truncated) {
      table.push([`La exportación se cortó en ${AUDIT_EXPORT_MAX_ROWS} filas: acota el rango o los filtros para ver el resto.`]);
    }

    // Exportar datos del equipo es en sí una acción que queda registrada (con el filtro usado, no con el contenido).
    await this.auditService.record({
      organizationId,
      actorId,
      action: "audit.exported",
      targetType: "AuditLog",
      metadata: {
        view,
        rows: kept.length,
        truncated,
        filters: { actor: query.actor ?? null, action: query.action ?? null, targetType: query.targetType ?? null, from: query.from ?? null, to: query.to ?? null, client: query.client ?? null },
      },
    });
    return toCsv(table);
  }
}
