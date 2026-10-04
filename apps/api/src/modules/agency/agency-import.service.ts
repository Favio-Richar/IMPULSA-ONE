import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AgencyImportJob } from "@impulza/agency";
import type { AgencyImportDetailResponse, AgencyImportListResponse, AgencyImportSummary } from "@impulza/contracts";
import { AgencyBillingMode, AgencyImportRowStatus, AgencyImportStatus, type AgencyImport, type PrismaClient } from "@impulza/database";
import { agencyImportTemplateCsv, importErrorReportCsv, prepareImport, type AgencyImportDetailQuery, type ImportCsvBody } from "@impulza/validation";
import type { Queue } from "bullmq";
import { PRISMA } from "../../database/prisma.module.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { PlansService } from "../plans/plans.service.js";
import { AgencyService } from "./agency.service.js";
import { AGENCY_IMPORT_QUEUE_TOKEN } from "./agency.tokens.js";

const LIST_LIMIT = 20;

function toSummary(row: AgencyImport): AgencyImportSummary {
  return {
    id: row.id,
    status: row.status,
    fileName: row.fileName,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    createdRows: row.createdRows,
    existedRows: row.existedRows,
    errorRows: row.errorRows,
    clientsLimit: row.clientsLimit,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Importar clientes por CSV (F9.5d, ADR-028 §2). La API **valida el archivo entero, fila por fila, en el servidor** y guarda cada fila (las
 * válidas pendientes, las inválidas con su motivo); después encola el trabajo y el **worker** crea los clientes (`@impulza/agency`). Aquí no
 * se crea ningún cliente: así subir un archivo grande responde al instante y el progreso se consulta aparte.
 */
@Injectable()
export class AgencyImportService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AGENCY_IMPORT_QUEUE_TOKEN) private readonly queue: Queue<AgencyImportJob>,
    private readonly audit: AuditService,
    private readonly plans: PlansService,
    private readonly agency: AgencyService,
  ) {}

  /** La plantilla descargable: el encabezado y dos filas de ejemplo (con BOM para que Excel respete los acentos). Solo para una agencia, como el resto. */
  async template(agencyOrganizationId: string): Promise<string> {
    await this.agency.assertAgency(agencyOrganizationId);
    return agencyImportTemplateCsv();
  }

  async create(agencyOrganizationId: string, actorId: string, body: ImportCsvBody): Promise<AgencyImportSummary> {
    await this.agency.assertAgency(agencyOrganizationId);
    const prepared = prepareImport(body.csv);
    if (!prepared.ok) throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "INVALID_IMPORT_FILE", message: prepared.message });

    // Una a la vez: dos importaciones simultáneas solo se disputarían el mismo cupo de clientes.
    const running = await this.prisma.agencyImport.count({ where: { agencyOrganizationId, status: { in: [AgencyImportStatus.QUEUED, AgencyImportStatus.RUNNING] } } });
    if (running > 0) {
      throw new ConflictException({ statusCode: 409, error: "Conflict", code: "IMPORT_IN_PROGRESS", message: "Ya hay una importación en curso. Espera a que termine para subir otro archivo." });
    }

    // El tope de clientes del plan queda congelado al subir: el worker no pasa de ahí aunque el plan cambie a mitad.
    const { plan } = await this.plans.resolveEffectivePlan(agencyOrganizationId);
    const invalid = prepared.rows.filter((row) => !row.ok).length;
    const valid = prepared.rows.length - invalid;

    const created = await this.prisma.$transaction(async (tx) => {
      const importRow = await tx.agencyImport.create({
        data: {
          agencyOrganizationId,
          createdById: actorId,
          // Sin ninguna fila válida no hay nada que procesar: nace terminada.
          status: valid > 0 ? AgencyImportStatus.QUEUED : AgencyImportStatus.COMPLETED,
          fileName: body.fileName ?? null,
          totalRows: prepared.rows.length,
          processedRows: invalid,
          errorRows: invalid,
          clientsLimit: plan.limits.clients,
          finishedAt: valid > 0 ? null : new Date(),
        },
      });
      await tx.agencyImportRow.createMany({
        data: prepared.rows.map((row) =>
          row.ok
            ? { importId: importRow.id, rowNumber: row.rowNumber, name: row.values.name, slug: row.values.slug, ownerEmail: row.values.ownerEmail, billingMode: row.values.billingMode as AgencyBillingMode }
            : { importId: importRow.id, rowNumber: row.rowNumber, name: row.raw.name, slug: row.raw.slug, ownerEmail: row.raw.ownerEmail, status: AgencyImportRowStatus.ERROR, errorCode: row.code, errorMessage: row.message },
        ),
      });
      return importRow;
    });

    await this.audit.record({
      organizationId: agencyOrganizationId,
      actorId,
      action: "agency.import.created",
      targetType: "AgencyImport",
      targetId: created.id,
      metadata: { totalRows: created.totalRows, invalidRows: invalid, fileName: body.fileName ?? null },
    });

    if (valid > 0) await this.enqueue(created.id);
    return toSummary(created);
  }

  async list(agencyOrganizationId: string): Promise<AgencyImportListResponse> {
    await this.agency.assertAgency(agencyOrganizationId);
    const rows = await this.prisma.agencyImport.findMany({ where: { agencyOrganizationId }, orderBy: { createdAt: "desc" }, take: LIST_LIMIT });
    return { items: rows.map(toSummary) };
  }

  async detail(agencyOrganizationId: string, importId: string, query: AgencyImportDetailQuery): Promise<AgencyImportDetailResponse> {
    await this.agency.assertAgency(agencyOrganizationId);
    const job = await this.ownImport(agencyOrganizationId, importId);
    const where = { importId: job.id, ...(query.onlyErrors ? { status: AgencyImportRowStatus.ERROR } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.agencyImportRow.count({ where }),
      this.prisma.agencyImportRow.findMany({ where, orderBy: { rowNumber: "asc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    return {
      import: toSummary(job),
      rows: {
        items: rows.map((row) => ({
          rowNumber: row.rowNumber,
          name: row.name,
          slug: row.slug,
          ownerEmail: row.ownerEmail,
          billingMode: row.billingMode,
          status: row.status,
          errorCode: row.errorCode,
          errorMessage: row.errorMessage,
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      },
    };
  }

  /** Las filas con problema, como un CSV seguro (sin fórmulas ejecutables) que se puede corregir y volver a subir. */
  async errorsCsv(agencyOrganizationId: string, importId: string): Promise<string> {
    await this.agency.assertAgency(agencyOrganizationId);
    const job = await this.ownImport(agencyOrganizationId, importId);
    const rows = await this.prisma.agencyImportRow.findMany({ where: { importId: job.id, status: AgencyImportRowStatus.ERROR }, orderBy: { rowNumber: "asc" } });
    return importErrorReportCsv(rows.map((row) => ({ rowNumber: row.rowNumber, rawName: row.name, rawSlug: row.slug, rawOwnerEmail: row.ownerEmail, errorMessage: row.errorMessage })));
  }

  /** Una importación que no es de esta agencia no existe para ella (ADR-002). */
  private async ownImport(agencyOrganizationId: string, importId: string): Promise<AgencyImport> {
    const job = await this.prisma.agencyImport.findFirst({ where: { id: importId, agencyOrganizationId } });
    if (!job) throw new NotFoundException("Esa importación no existe.");
    return job;
  }

  /**
   * Encola el trabajo. Si la cola no responde, la importación queda guardada y el mantenimiento del worker la retoma sola: subir el archivo
   * no falla por eso. `jobId` = id de la importación: encolarla dos veces no la procesa dos veces.
   */
  private async enqueue(importId: string): Promise<void> {
    try {
      await this.queue.add("process", { importId }, { jobId: importId, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 100, removeOnFail: 500 });
    } catch (error) {
      logger.error("agency.import.enqueue_failed", { importId, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
