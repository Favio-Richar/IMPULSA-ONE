import { generateVerificationToken, type EmailAdapter } from "@impulza/auth";
import {
  AgencyClientStatus,
  AgencyImportRowStatus,
  AgencyImportStatus,
  OrganizationKind,
  Prisma,
  type AgencyImport,
  type AgencyImportRow,
  type PrismaClient,
} from "@impulza/database";
import { AGENCY_IMPORT_ERROR_TEXT, AGENCY_OWNER_INVITE_TTL_DAYS, type AgencyImportErrorCode } from "@impulza/validation";
import { createAgencyClientRecords } from "./client.js";
import { ownerInviteEmail, ownerInviteUrl } from "./invite-email.js";

/** Nombre de la cola BullMQ: la API encola, el worker consume. */
export const AGENCY_IMPORT_QUEUE = "agency-import";

export interface AgencyImportJob {
  importId: string;
}

export interface AgencyImportOptions {
  email: EmailAdapter;
  /** Dónde vive el panel: de aquí sale el enlace de la invitación al propietario. */
  appBaseUrl: string;
  now?: () => Date;
  log?: (event: string, data: Record<string, unknown>) => void;
}

const BATCH = 25;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Una fila «en proceso» que lleva tanto sin avanzar es de un worker que murió: vuelve a la cola (crearla es idempotente). */
const STALE_PROCESSING_MS = 5 * 60_000;
/** Una importación sin avances en este tiempo se retoma sola (la cola perdió el trabajo o el worker murió). */
export const STALE_IMPORT_MS = 2 * 60_000;
/** Las filas guardan correos de terceros: se borran pasado este tiempo. */
export const IMPORT_RETENTION_DAYS = 60;

class QuotaReached extends Error {}

type RowOutcome =
  | { kind: "created"; clientOrganizationId: string }
  | { kind: "existed"; clientOrganizationId: string }
  | { kind: "error"; code: AgencyImportErrorCode; message?: string };

type ImportWithAgency = AgencyImport & { agencyOrganization: { id: string; name: string; kind: OrganizationKind } };

/**
 * Crea los clientes de una importación (F9.5d). Lo corre el worker desde la cola; también se puede llamar directo (recuperación y pruebas).
 *
 * - **Una fila a la vez, cada una en su transacción:** un error no frena a las demás y el progreso se ve fila a fila.
 * - **Idempotente:** cada fila se *reclama* antes de crearse (`PENDING → PROCESSING`), así dos workers nunca crean la misma; y si un
 *   identificador ya es un cliente de esta agencia creado con ese mismo correo, la fila queda `EXISTED` en vez de duplicarse.
 * - **Respeta el cupo del plan:** con el mismo candado que usa la API para crear clientes, así una importación y un alta manual no pasan
 *   juntas el límite. Las filas que ya no caben quedan con error `NO_QUOTA`, no se pierden en silencio.
 * - Termina cuando no queda ninguna fila pendiente (aunque haya filas con error: eso es un informe, no un fallo).
 */
export async function processAgencyImport(prisma: PrismaClient, importId: string, options: AgencyImportOptions): Promise<{ processed: number }> {
  const now = options.now ?? (() => new Date());
  const job = await prisma.agencyImport.findUnique({ where: { id: importId }, include: { agencyOrganization: { select: { id: true, name: true, kind: true } } } });
  if (!job || job.status === AgencyImportStatus.COMPLETED) return { processed: 0 };

  await prisma.agencyImport.updateMany({ where: { id: importId, status: AgencyImportStatus.QUEUED }, data: { status: AgencyImportStatus.RUNNING, startedAt: now() } });
  await prisma.agencyImportRow.updateMany({
    where: { importId, status: AgencyImportRowStatus.PROCESSING, updatedAt: { lt: new Date(now().getTime() - STALE_PROCESSING_MS) } },
    data: { status: AgencyImportRowStatus.PENDING },
  });

  let processed = 0;
  for (;;) {
    const rows = await prisma.agencyImportRow.findMany({ where: { importId, status: AgencyImportRowStatus.PENDING }, orderBy: { rowNumber: "asc" }, take: BATCH });
    if (rows.length === 0) break;
    for (const row of rows) {
      const claimed = await prisma.agencyImportRow.updateMany({ where: { id: row.id, status: AgencyImportRowStatus.PENDING }, data: { status: AgencyImportRowStatus.PROCESSING } });
      if (claimed.count !== 1) continue; // otro worker la tomó
      const outcome = await createOne(prisma, job, row, options, now);
      await finishRow(prisma, importId, row.id, outcome);
      processed += 1;
    }
  }

  const open = await prisma.agencyImportRow.count({ where: { importId, status: { in: [AgencyImportRowStatus.PENDING, AgencyImportRowStatus.PROCESSING] } } });
  if (open === 0) {
    await prisma.agencyImport.updateMany({ where: { id: importId, status: { not: AgencyImportStatus.COMPLETED } }, data: { status: AgencyImportStatus.COMPLETED, finishedAt: now() } });
  }
  options.log?.("agency.import.processed", { importId, processed, open });
  return { processed };
}

async function findExisting(prisma: PrismaClient, job: ImportWithAgency, row: AgencyImportRow): Promise<{ id: string } | "taken" | null> {
  const organization = await prisma.organization.findUnique({ where: { slug: row.slug }, select: { id: true } });
  if (!organization) return null;
  const mine = await prisma.agencyClient.findFirst({
    where: {
      clientOrganizationId: organization.id,
      agencyOrganizationId: job.agencyOrganizationId,
      agencyCreated: true,
      ownerInviteEmail: row.ownerEmail,
      status: { not: AgencyClientStatus.ENDED },
    },
    select: { id: true },
  });
  return mine ? organization : "taken";
}

async function createOne(prisma: PrismaClient, job: ImportWithAgency, row: AgencyImportRow, options: AgencyImportOptions, now: () => Date): Promise<RowOutcome> {
  if (job.agencyOrganization.kind !== OrganizationKind.AGENCY) {
    return { kind: "error", code: "FAILED", message: "Esta organización ya no es una agencia: no se pueden crear clientes." };
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await findExisting(prisma, job, row);
    if (existing === "taken") return { kind: "error", code: "SLUG_TAKEN" };
    if (existing) return { kind: "existed", clientOrganizationId: existing.id };

    const { raw, hash } = generateVerificationToken();
    try {
      const created = await prisma.$transaction(async (tx) => {
        // El mismo candado que `PlansService.assertWithinLimit` (clave `plan-limit:<organización>:clients`): una importación y un alta manual no pasan juntas el cupo.
        await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`plan-limit:${job.agencyOrganizationId}:clients`}))) AS acquired`;
        if (job.clientsLimit !== null) {
          const used = await tx.agencyClient.count({ where: { agencyOrganizationId: job.agencyOrganizationId, status: { not: AgencyClientStatus.ENDED } } });
          if (used >= job.clientsLimit) throw new QuotaReached();
        }
        const { organization, relation } = await createAgencyClientRecords(tx, {
          agencyOrganizationId: job.agencyOrganizationId,
          actorId: job.createdById,
          name: row.name,
          slug: row.slug,
          ownerEmail: row.ownerEmail,
          billingMode: row.billingMode,
          inviteTokenHash: hash,
          inviteExpiresAt: new Date(now().getTime() + AGENCY_OWNER_INVITE_TTL_DAYS * DAY_MS),
        });
        await tx.auditLog.createMany({
          data: [
            { organizationId: job.agencyOrganizationId, actorId: job.createdById, action: "agency.client.created", targetType: "AgencyClient", targetId: relation.id, metadata: { clientOrganizationId: organization.id, billingMode: row.billingMode, importId: job.id } },
            { organizationId: organization.id, actorId: job.createdById, action: "agency.link.created", targetType: "AgencyClient", targetId: relation.id, metadata: { agencyOrganizationId: job.agencyOrganizationId, agencyCreated: true, importId: job.id } },
          ],
        });
        return organization;
      });

      // El correo sale después de confirmar: un fallo del proveedor no deshace el alta (el propietario se puede reinvitar).
      try {
        await options.email.send({
          to: row.ownerEmail,
          ...ownerInviteEmail({ agencyName: job.agencyOrganization.name, clientName: row.name, inviteUrl: ownerInviteUrl(options.appBaseUrl, raw) }),
        });
      } catch (error) {
        options.log?.("agency.import.email_failed", { importId: job.id, rowNumber: row.rowNumber, error: error instanceof Error ? error.message : String(error) });
      }
      return { kind: "created", clientOrganizationId: created.id };
    } catch (error) {
      if (error instanceof QuotaReached) return { kind: "error", code: "NO_QUOTA" };
      // El identificador lo tomó otro justo en medio: se vuelve a mirar una vez (puede ser esta misma fila reintentada).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt === 0) continue;
      options.log?.("agency.import.row_failed", { importId: job.id, rowNumber: row.rowNumber, error: error instanceof Error ? error.message : String(error) });
      return { kind: "error", code: "FAILED" };
    }
  }
  return { kind: "error", code: "FAILED" };
}

/** Guarda el resultado de la fila y avanza los contadores en la misma transacción: el progreso nunca se descuadra. */
async function finishRow(prisma: PrismaClient, importId: string, rowId: string, outcome: RowOutcome): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (outcome.kind === "error") {
      await tx.agencyImportRow.update({
        where: { id: rowId },
        data: { status: AgencyImportRowStatus.ERROR, errorCode: outcome.code, errorMessage: outcome.message ?? AGENCY_IMPORT_ERROR_TEXT[outcome.code] },
      });
      await tx.agencyImport.update({ where: { id: importId }, data: { processedRows: { increment: 1 }, errorRows: { increment: 1 } } });
      return;
    }
    const created = outcome.kind === "created";
    await tx.agencyImportRow.update({
      where: { id: rowId },
      data: { status: created ? AgencyImportRowStatus.CREATED : AgencyImportRowStatus.EXISTED, clientOrganizationId: outcome.clientOrganizationId },
    });
    await tx.agencyImport.update({ where: { id: importId }, data: { processedRows: { increment: 1 }, ...(created ? { createdRows: { increment: 1 } } : { existedRows: { increment: 1 } }) } });
  });
}

/**
 * Mantenimiento (cada minuto, en el worker): retoma las importaciones que quedaron sin avanzar (la cola perdió el trabajo, o el worker
 * murió a la mitad) y borra las viejas, que guardan correos de terceros. Devuelve cuántas retomó.
 */
export async function maintainAgencyImports(prisma: PrismaClient, options: AgencyImportOptions): Promise<{ resumed: number; purged: number }> {
  const now = (options.now ?? (() => new Date()))();
  const stale = await prisma.agencyImport.findMany({
    where: { status: { in: [AgencyImportStatus.QUEUED, AgencyImportStatus.RUNNING] }, updatedAt: { lt: new Date(now.getTime() - STALE_IMPORT_MS) } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  for (const job of stale) await processAgencyImport(prisma, job.id, options);
  const purged = await prisma.agencyImport.deleteMany({ where: { status: AgencyImportStatus.COMPLETED, finishedAt: { lt: new Date(now.getTime() - IMPORT_RETENTION_DAYS * DAY_MS) } } });
  return { resumed: stale.length, purged: purged.count };
}
