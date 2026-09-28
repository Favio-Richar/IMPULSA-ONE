import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AiUnavailableError, runWithFallback, type AiAttempt, type AiProviderFactory } from "@impulza/ai";
import { encryptSecret } from "@impulza/auth";
import type {
  AdminAiConnectionResponse,
  AdminAiConnectionTestResponse,
  AdminAiRoutesResponse,
  AdminAiUsageResponse,
} from "@impulza/contracts";
import { Prisma, type AiConnection, type PrismaClient } from "@impulza/database";
import {
  AI_TASK_CODES,
  apiKeyHint,
  type AiRoutesInput,
  type CreateAiConnectionInput,
  type UpdateAiConnectionInput,
} from "@impulza/validation";
import { z } from "zod";
import { isUniqueViolation } from "../../common/prisma-errors.js";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { logger } from "../../observability/logger.js";
import { AuditService } from "../audit/audit.service.js";
import { AI_PROVIDER_FACTORY, AiService } from "./ai.service.js";

const NAME_TAKEN = "Ya existe una conexión con ese nombre.";

/** Lo que se audita de una conexión: todo menos el token (solo si cambió). */
function auditView(connection: AiConnection) {
  return {
    name: connection.name,
    kind: connection.kind,
    baseUrl: connection.baseUrl,
    model: connection.model,
    jsonMode: connection.jsonMode,
    timeoutMs: connection.timeoutMs,
    inputMicroUsdPerMTok: connection.inputMicroUsdPerMTok,
    outputMicroUsdPerMTok: connection.outputMicroUsdPerMTok,
    enabled: connection.enabled,
    hasApiKey: connection.apiKeyEncrypted !== null,
  };
}

interface UsageGroupRow {
  outcome: string;
  _count: { _all: number };
  _sum: { inputTokens: number | null; outputTokens: number | null; costMicroUsd: number | null };
}

/** Suma filas agrupadas por resultado: una solicitud exitosa tiene exactamente un intento `ok`. */
function foldUsage(rows: readonly UsageGroupRow[]) {
  return rows.reduce(
    (acc, row) => ({
      requests: acc.requests + (row.outcome === "ok" ? row._count._all : 0),
      attempts: acc.attempts + row._count._all,
      failures: acc.failures + (row.outcome === "ok" ? 0 : row._count._all),
      inputTokens: acc.inputTokens + (row._sum.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (row._sum.outputTokens ?? 0),
      costMicroUsd: acc.costMicroUsd + (row._sum.costMicroUsd ?? 0),
    }),
    { requests: 0, attempts: 0, failures: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 },
  );
}

function groupRows<T extends UsageGroupRow>(rows: readonly T[], key: (row: T) => string | null): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const k = key(row);
    groups.set(k, [...(groups.get(k) ?? []), row]);
  }
  return groups;
}

/** Pedido mínimo de "Probar conexión": comprueba red, credencial, modelo y salida JSON a la vez. */
const PING_REQUEST = {
  system: "Eres un verificador de conexión. No agregues nada más.",
  prompt: 'Responde exactamente con el objeto JSON {"ok": true}.',
  schema: z.object({ ok: z.literal(true) }),
  schemaName: "connection_test",
  maxOutputTokens: 300,
  effort: "low" as const,
};

/**
 * Conexiones de IA de la plataforma, administradas por el propietario (F6.2b, ADR-010). Solo se
 * alcanza por `AdminAiController` (sesión de superadministración con TOTP). Cada cambio queda en la
 * auditoría con el antes y el después, **sin el token**: se cifra al guardarse y nunca vuelve a salir.
 */
@Injectable()
export class AdminAiService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AI_PROVIDER_FACTORY) private readonly providerFactory: AiProviderFactory,
    private readonly aiService: AiService,
    private readonly auditService: AuditService,
  ) {}

  async listConnections(): Promise<AdminAiConnectionResponse[]> {
    const connections = await this.prisma.aiConnection.findMany({ orderBy: { createdAt: "asc" }, include: { routes: true } });
    return connections.map((connection) => this.toResponse(connection, connection.routes.map((route) => route.task)));
  }

  async createConnection(adminId: string, input: CreateAiConnectionInput): Promise<AdminAiConnectionResponse> {
    const { apiKey, ...fields } = input;
    let created: AiConnection;
    try {
      created = await this.prisma.aiConnection.create({
        data: {
          ...fields,
          apiKeyEncrypted: apiKey ? encryptSecret(apiKey, env.AUTH_ENCRYPTION_KEY) : null,
          apiKeyHint: apiKey ? apiKeyHint(apiKey) : null,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(NAME_TAKEN);
      }
      throw error;
    }
    await this.auditService.record({
      actorId: adminId,
      action: "admin.ai_connection_created",
      targetType: "AiConnection",
      targetId: created.id,
      metadata: { after: auditView(created) },
    });
    logger.info("superadministración creó una conexión de IA", { adminId, connectionId: created.id, kind: created.kind });
    return this.toResponse(created, []);
  }

  async updateConnection(adminId: string, id: string, input: UpdateAiConnectionInput): Promise<AdminAiConnectionResponse> {
    const before = await this.getOrThrow(id);
    const { apiKey, ...fields } = input;
    const kind = fields.kind ?? before.kind;
    const baseUrl = fields.baseUrl !== undefined ? fields.baseUrl : before.baseUrl;
    if (kind === "OPENAI_COMPATIBLE" && !baseUrl) {
      throw new BadRequestException("Una conexión compatible con OpenAI necesita la URL del servidor.");
    }

    let updated: AiConnection & { routes: Array<{ task: string }> };
    try {
      updated = await this.prisma.aiConnection.update({
        where: { id },
        data: {
          ...fields,
          ...(apiKey !== undefined
            ? {
                apiKeyEncrypted: apiKey ? encryptSecret(apiKey, env.AUTH_ENCRYPTION_KEY) : null,
                apiKeyHint: apiKey ? apiKeyHint(apiKey) : null,
              }
            : {}),
        },
        include: { routes: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(NAME_TAKEN);
      }
      throw error;
    }
    await this.auditService.record({
      actorId: adminId,
      action: "admin.ai_connection_updated",
      targetType: "AiConnection",
      targetId: id,
      metadata: { before: auditView(before), after: auditView(updated), apiKeyChanged: apiKey !== undefined },
    });
    logger.info("superadministración editó una conexión de IA", { adminId, connectionId: id });
    return this.toResponse(updated, updated.routes.map((route) => route.task));
  }

  async deleteConnection(adminId: string, id: string): Promise<void> {
    const connection = await this.getOrThrow(id);
    // El historial de uso se conserva: `AiUsage.connectionId` pasa a null (SET NULL) y guarda el modelo.
    await this.prisma.aiConnection.delete({ where: { id } });
    await this.auditService.record({
      actorId: adminId,
      action: "admin.ai_connection_deleted",
      targetType: "AiConnection",
      targetId: id,
      metadata: { before: auditView(connection) },
    });
    logger.info("superadministración borró una conexión de IA", { adminId, connectionId: id });
  }

  /** Llamada mínima real, sin reintentos ni respaldo: mide esta conexión y nada más. */
  async testConnection(adminId: string, id: string): Promise<AdminAiConnectionTestResponse> {
    const connection = await this.getOrThrow(id);
    let attempts: AiAttempt[];
    let ok = true;
    try {
      attempts = (await runWithFallback([this.aiService.toConfig(connection)], PING_REQUEST, this.providerFactory, { retriesPerConnection: 0 })).attempts;
    } catch (error) {
      if (!(error instanceof AiUnavailableError)) {
        throw error;
      }
      attempts = error.attempts;
      ok = false;
    }
    await this.aiService.recordUsage({
      organizationId: null,
      userId: adminId,
      task: "connection_test",
      requestId: randomUUID(),
      attempts,
      connections: [{ row: connection }],
    });
    const attempt = attempts[0];
    return {
      ok,
      outcome: attempt?.outcome ?? "provider_error",
      model: ok ? (attempt?.model ?? null) : null,
      durationMs: attempt?.durationMs ?? 0,
      inputTokens: attempt?.inputTokens ?? 0,
      outputTokens: attempt?.outputTokens ?? 0,
    };
  }

  async getRoutes(): Promise<AdminAiRoutesResponse> {
    const rows = await this.prisma.aiRoute.findMany({ orderBy: [{ task: "asc" }, { position: "asc" }] });
    const routes: Record<string, string[]> = Object.fromEntries(AI_TASK_CODES.map((task) => [task, []]));
    for (const row of rows) {
      (routes[row.task] ??= []).push(row.connectionId);
    }
    return { routes };
  }

  /** Reemplaza todas las rutas de una vez, en una transacción: nunca queda una mitad aplicada. */
  async setRoutes(adminId: string, input: AiRoutesInput): Promise<AdminAiRoutesResponse> {
    const ids = [...new Set(Object.values(input.routes).flat())];
    const existing = await this.prisma.aiConnection.count({ where: { id: { in: ids } } });
    if (existing !== ids.length) {
      throw new BadRequestException("Alguna conexión de la ruta no existe.");
    }
    const before = await this.getRoutes();
    await this.prisma.$transaction([
      this.prisma.aiRoute.deleteMany({}),
      this.prisma.aiRoute.createMany({
        data: AI_TASK_CODES.flatMap((task) => input.routes[task].map((connectionId, position) => ({ task, connectionId, position }))),
      }),
    ]);
    const after = await this.getRoutes();
    await this.auditService.record({
      actorId: adminId,
      action: "admin.ai_routes_updated",
      targetType: "AiRoute",
      targetId: null,
      metadata: { before: before.routes, after: after.routes },
    });
    logger.info("superadministración cambió las rutas de IA", { adminId });
    return after;
  }

  async usage(now = new Date()): Promise<AdminAiUsageResponse> {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const where: Prisma.AiUsageWhereInput = { createdAt: { gte: start, lt: end } };
    const sums = { _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true } } as const;

    const [byConnectionRows, byTaskRows, byOrgRows, connections] = await Promise.all([
      this.prisma.aiUsage.groupBy({ by: ["connectionId", "outcome"], where, ...sums }),
      this.prisma.aiUsage.groupBy({ by: ["task", "outcome"], where, ...sums }),
      this.prisma.aiUsage.groupBy({ by: ["organizationId", "outcome"], where: { ...where, organizationId: { not: null } }, ...sums }),
      this.prisma.aiConnection.findMany({ select: { id: true, name: true } }),
    ]);

    const names = new Map(connections.map((connection) => [connection.id, connection.name]));
    const byConnection = [...groupRows(byConnectionRows, (row) => row.connectionId)].map(([connectionId, rows]) => ({
      connectionId,
      name: connectionId ? (names.get(connectionId) ?? "Conexión borrada") : "Conexión borrada",
      ...foldUsage(rows),
    }));
    const byTask = [...groupRows(byTaskRows, (row) => row.task)].map(([task, rows]) => ({ task: task ?? "", ...foldUsage(rows) }));
    const orgTotals = [...groupRows(byOrgRows, (row) => row.organizationId)]
      .map(([organizationId, rows]) => ({ organizationId: organizationId ?? "", ...foldUsage(rows) }))
      .sort((a, b) => b.requests - a.requests || b.costMicroUsd - a.costMicroUsd)
      .slice(0, 10);
    const orgNames = new Map(
      (await this.prisma.organization.findMany({ where: { id: { in: orgTotals.map((row) => row.organizationId) } }, select: { id: true, name: true } })).map(
        (org) => [org.id, org.name],
      ),
    );

    return {
      period: start.toISOString().slice(0, 7),
      totals: foldUsage(byTaskRows),
      byConnection: byConnection.sort((a, b) => b.attempts - a.attempts),
      byTask: byTask.sort((a, b) => b.attempts - a.attempts),
      topOrganizations: orgTotals.map((row) => ({
        organizationId: row.organizationId,
        name: orgNames.get(row.organizationId) ?? "Organización borrada",
        requests: row.requests,
        costMicroUsd: row.costMicroUsd,
      })),
    };
  }

  private async getOrThrow(id: string): Promise<AiConnection> {
    const connection = await this.prisma.aiConnection.findUnique({ where: { id } });
    if (!connection) {
      throw new NotFoundException("Conexión no encontrada.");
    }
    return connection;
  }

  private toResponse(connection: AiConnection, tasks: string[]): AdminAiConnectionResponse {
    return {
      id: connection.id,
      name: connection.name,
      kind: connection.kind,
      baseUrl: connection.baseUrl,
      hasApiKey: connection.apiKeyEncrypted !== null,
      apiKeyHint: connection.apiKeyHint,
      model: connection.model,
      jsonMode: connection.jsonMode,
      timeoutMs: connection.timeoutMs,
      inputMicroUsdPerMTok: connection.inputMicroUsdPerMTok,
      outputMicroUsdPerMTok: connection.outputMicroUsdPerMTok,
      enabled: connection.enabled,
      tasks,
      createdAt: connection.createdAt.toISOString(),
      updatedAt: connection.updatedAt.toISOString(),
    };
  }
}
