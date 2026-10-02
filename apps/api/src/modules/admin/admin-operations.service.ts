import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import {
  type AdminFeatureFlagListResponse,
  type AdminFeatureFlagResponse,
  type AdminQueueActionResultResponse,
  type AdminQueueMetricsResponse,
  type AdminSystemHealthResponse,
  type AdminTemplateListResponse,
  type AdminTemplateSummaryResponse,
} from "@impulza/contracts";
import { Prisma, type PrismaClient } from "@impulza/database";
import {
  BULLMQ_QUEUES,
  type BullMqQueueName,
  SYSTEM_FEATURE_FLAGS,
  type QueueAction,
  type UpdateFeatureFlagDto,
  type UpdateTemplateAdminDto,
} from "@impulza/validation";
import { PRISMA } from "../../database/prisma.module.js";
import { env } from "../../env.js";
import { REDIS } from "../../redis/redis.module.js";
import { AuditService } from "../audit/audit.service.js";

const QUEUE_DISPLAY_NAMES: Record<BullMqQueueName, string> = {
  "analytics-events": "Eventos de analítica",
  "automation-events": "Automatizaciones",
  "media-process": "Procesamiento de imágenes",
  "media-video-process": "Procesamiento de video",
  "webhook-deliveries": "Entregas de webhooks",
  "billing-renewals": "Renovaciones de suscripción",
  "booking-deposits": "Depósitos de reservas",
  "booking-reminders": "Recordatorios de reservas",
  "campaign-dispatch": "Despacho de campañas",
  "newsletter-confirmation": "Confirmaciones de newsletter",
  "page-campaign-boundary": "Vigencia de campañas de página",
  "payment-accounts-reconciliation": "Conciliación de cuentas de pago",
  "sequence-dispatch": "Despacho de secuencias de email",
};

@Injectable()
export class AdminOperationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  /**
   * Inspección completa del estado técnico de la plataforma (F7.11, ADR-026).
   */
  async getSystemHealth(adminId: string): Promise<AdminSystemHealthResponse> {
    const startDb = Date.now();
    let dbStatus: "ok" | "error" = "ok";
    let dbError: string | undefined;
    let counts = { users: 0, organizations: 0, sites: 0, bookings: 0, orders: 0 };
    try {
      await this.prisma.$queryRawUnsafe("SELECT 1");
      const [users, organizations, sites, bookings, orders] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.organization.count(),
        this.prisma.site.count(),
        this.prisma.booking.count(),
        this.prisma.order.count(),
      ]);
      counts = { users, organizations, sites, bookings, orders };
    } catch (err) {
      dbStatus = "error";
      dbError = err instanceof Error ? err.message : String(err);
    }
    const dbLatencyMs = Date.now() - startDb;

    const startRedis = Date.now();
    let redisStatus: "ok" | "error" = "ok";
    let redisError: string | undefined;
    let memoryUsedBytes: number | undefined;
    let connectedClients: number | undefined;
    try {
      const pong = await this.redis.ping();
      if (pong !== "PONG") {
        throw new Error(`Respuesta inesperada de Redis: ${pong}`);
      }
      try {
        const infoMemory = await this.redis.info("memory");
        const memMatch = infoMemory.match(/used_memory:(\d+)/);
        if (memMatch && memMatch[1]) memoryUsedBytes = parseInt(memMatch[1], 10);

        const infoClients = await this.redis.info("clients");
        const clientsMatch = infoClients.match(/connected_clients:(\d+)/);
        if (clientsMatch && clientsMatch[1]) connectedClients = parseInt(clientsMatch[1], 10);
      } catch {
        // En tests o mocks redis.info puede no estar implementado
      }
    } catch (err) {
      redisStatus = "error";
      redisError = err instanceof Error ? err.message : String(err);
    }
    const redisLatencyMs = Date.now() - startRedis;

    let workerStatus: "ok" | "down" = "ok";
    let workerLatencyMs: number | undefined;
    let workerError: string | undefined;
    try {
      const startWorker = Date.now();
      const res = await fetch("http://localhost:4100/health", {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      workerLatencyMs = Date.now() - startWorker;
    } catch (err) {
      workerStatus = "down";
      workerError = err instanceof Error ? err.message : String(err);
    }

    const storageConfigured = !!(process.env.STORAGE_PROVIDER || process.env.S3_BUCKET || process.env.STORAGE_BUCKET);
    const storage = {
      status: storageConfigured ? ("configured" as const) : ("not_configured" as const),
      provider: process.env.STORAGE_PROVIDER || (storageConfigured ? "s3-compatible" : "none"),
      bucket: process.env.S3_BUCKET || process.env.STORAGE_BUCKET || undefined,
    };

    const webpayConfigured = !!(process.env.WEBPAY_COMMERCE_CODE || process.env.WEBPAY_API_KEY);
    const mpConfigured = !!process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const gateways = {
      webpay: {
        configured: webpayConfigured,
        mode: (webpayConfigured
          ? process.env.WEBPAY_ENVIRONMENT === "production"
            ? "production"
            : "test"
          : "disabled") as "test" | "production" | "disabled",
      },
      mercadoPago: {
        configured: mpConfigured,
        mode: (mpConfigured
          ? process.env.MERCADO_PAGO_ENVIRONMENT === "production"
            ? "production"
            : "test"
          : "disabled") as "test" | "production" | "disabled",
      },
    };

    const mem = process.memoryUsage();
    const processInfo = {
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        rssBytes: mem.rss,
      },
      nodeVersion: process.version,
    };

    const status: "ok" | "degraded" | "error" =
      dbStatus === "error" || redisStatus === "error"
        ? "error"
        : workerStatus === "down"
          ? "degraded"
          : "ok";

    await this.auditService.record({
      actorId: adminId,
      action: "admin.system_health_inspected",
      targetType: "System",
      targetId: "health",
      metadata: { status, dbStatus, redisStatus, workerStatus },
    });

    return {
      status,
      database: {
        status: dbStatus,
        latencyMs: dbLatencyMs,
        counts,
        error: dbError,
      },
      redis: {
        status: redisStatus,
        latencyMs: redisLatencyMs,
        memoryUsedBytes,
        connectedClients,
        error: redisError,
      },
      worker: {
        status: workerStatus,
        latencyMs: workerLatencyMs,
        error: workerError,
      },
      storage,
      gateways,
      process: processInfo,
    };
  }

  /**
   * Métricas en tiempo real de las 13 colas BullMQ.
   */
  async getQueueMetrics(): Promise<AdminQueueMetricsResponse> {
    const queues: AdminQueueMetricsResponse["queues"] = [];
    for (const name of BULLMQ_QUEUES) {
      const queue = new Queue(name, {
        connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
      });
      try {
        const [counts, paused] = await Promise.all([
          queue.getJobCounts("waiting", "active", "completed", "failed", "delayed"),
          queue.isPaused(),
        ]);
        queues.push({
          name,
          displayName: QUEUE_DISPLAY_NAMES[name] || name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          paused: !!paused,
        });
      } finally {
        await queue.close();
      }
    }
    return { queues };
  }

  /**
   * Operaciones sobre una cola BullMQ (pausa, reanudación, reintento, purga).
   */
  async executeQueueAction(
    queueName: string,
    action: QueueAction,
    adminId: string,
  ): Promise<AdminQueueActionResultResponse> {
    if (!BULLMQ_QUEUES.includes(queueName as BullMqQueueName)) {
      throw new NotFoundException(`Cola no encontrada: ${queueName}`);
    }
    const queue = new Queue(queueName, {
      connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
    });
    try {
      let message = "";
      if (action === "pause") {
        await queue.pause();
        message = `Cola ${queueName} pausada`;
      } else if (action === "resume") {
        await queue.resume();
        message = `Cola ${queueName} reanudada`;
      } else if (action === "retry-failed") {
        await queue.retryJobs({ count: 1000 });
        message = `Trabajos fallidos de ${queueName} reenviados`;
      } else if (action === "clean") {
        await queue.clean(0, 1000, "completed");
        await queue.clean(0, 1000, "failed");
        message = `Trabajos antiguos de ${queueName} purgados`;
      } else {
        throw new BadRequestException(`Acción no soportada: ${action}`);
      }

      await this.auditService.record({
        actorId: adminId,
        action: `admin.queue_${action.replace("-", "_")}`,
        targetType: "Queue",
        targetId: queueName,
        metadata: { queueName, action },
      });

      return { success: true, queueName, action, message };
    } finally {
      await queue.close();
    }
  }

  /**
   * Listado de feature flags globales y por organización.
   */
  async listFeatureFlags(): Promise<AdminFeatureFlagListResponse> {
    for (const flag of SYSTEM_FEATURE_FLAGS) {
      await this.prisma.featureFlag.upsert({
        where: { key: flag.key },
        create: {
          key: flag.key,
          name: flag.name,
          description: flag.description,
          enabled: flag.defaultEnabled,
        },
        update: {},
      });
    }

    const items = await this.prisma.featureFlag.findMany({
      orderBy: { key: "asc" },
    });

    return {
      items: items.map((f) => ({
        id: f.id,
        key: f.key,
        name: f.name,
        description: f.description,
        enabled: f.enabled,
        rules: (f.rules as Record<string, unknown>) ?? null,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
      total: items.length,
    };
  }

  /**
   * Actualización de estado y reglas de un feature flag con invalidación en Redis y auditoría.
   */
  async updateFeatureFlag(
    key: string,
    dto: UpdateFeatureFlagDto,
    adminId: string,
  ): Promise<AdminFeatureFlagResponse> {
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key },
    });
    if (!existing) {
      throw new NotFoundException(`Bandera de funcionalidad no encontrada: ${key}`);
    }

    const updated = await this.prisma.featureFlag.update({
      where: { key },
      data: {
        enabled: dto.enabled,
        ...(dto.rules !== undefined ? { rules: dto.rules === null ? Prisma.JsonNull : (dto.rules as Prisma.InputJsonValue) } : {}),
      },
    });

    await this.redis.del(`feature_flag:${key}`);
    await this.redis.del("feature_flags:all");

    await this.auditService.record({
      actorId: adminId,
      action: "admin.feature_flag_updated",
      targetType: "FeatureFlag",
      targetId: updated.id,
      metadata: { key, enabled: dto.enabled, rules: dto.rules },
    });

    return {
      id: updated.id,
      key: updated.key,
      name: updated.name,
      description: updated.description,
      enabled: updated.enabled,
      rules: (updated.rules as Record<string, unknown>) ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Evaluación de un feature flag con soporte de caché en Redis (ADR-026).
   */
  async isFeatureEnabled(key: string, organizationId?: string): Promise<boolean> {
    const cacheKey = `feature_flag:${key}`;
    const cached = await this.redis.get(cacheKey);
    let flagData: { enabled: boolean; rules: Record<string, unknown> | null };

    if (cached) {
      try {
        flagData = JSON.parse(cached);
      } catch {
        flagData = await this.fetchFlagAndCache(key, cacheKey);
      }
    } else {
      flagData = await this.fetchFlagAndCache(key, cacheKey);
    }

    if (!flagData.enabled) return false;
    if (!organizationId || !flagData.rules) return true;

    const allowlist = flagData.rules.allowedOrganizations as string[] | undefined;
    if (Array.isArray(allowlist) && allowlist.length > 0) {
      return allowlist.includes(organizationId);
    }
    const blocklist = flagData.rules.blockedOrganizations as string[] | undefined;
    if (Array.isArray(blocklist) && blocklist.length > 0) {
      return !blocklist.includes(organizationId);
    }

    return true;
  }

  private async fetchFlagAndCache(key: string, cacheKey: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    const data = flag
      ? { enabled: flag.enabled, rules: (flag.rules as Record<string, unknown>) ?? null }
      : { enabled: false, rules: null };
    await this.redis.set(cacheKey, JSON.stringify(data), "EX", 60);
    return data;
  }

  /**
   * Catálogo de plantillas para superadministración (CMS).
   */
  async listTemplates(): Promise<AdminTemplateListResponse> {
    const templates = await this.prisma.template.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return {
      items: templates.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        description: t.description,
        industryTags: t.industryTags,
        objectiveTags: t.objectiveTags,
        themeCode: t.themeCode,
        family: t.family,
        previewImageUrl: t.previewImageUrl,
        sortOrder: t.sortOrder,
        isActive: t.isActive,
        isFeatured: t.isFeatured,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      total: templates.length,
    };
  }

  /**
   * Actualización de plantilla (visibilidad pública, destacada y orden) con auditoría.
   */
  async updateTemplate(
    id: string,
    dto: UpdateTemplateAdminDto,
    adminId: string,
  ): Promise<AdminTemplateSummaryResponse> {
    const existing = await this.prisma.template.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Plantilla no encontrada: ${id}`);
    }

    const updated = await this.prisma.template.update({
      where: { id },
      data: {
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isFeatured !== undefined ? { isFeatured: dto.isFeatured } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });

    await this.auditService.record({
      actorId: adminId,
      action: "admin.template_updated",
      targetType: "Template",
      targetId: updated.id,
      metadata: {
        code: updated.code,
        isActive: dto.isActive,
        isFeatured: dto.isFeatured,
        sortOrder: dto.sortOrder,
      },
    });

    return {
      id: updated.id,
      code: updated.code,
      name: updated.name,
      description: updated.description,
      industryTags: updated.industryTags,
      objectiveTags: updated.objectiveTags,
      themeCode: updated.themeCode,
      family: updated.family,
      previewImageUrl: updated.previewImageUrl,
      sortOrder: updated.sortOrder,
      isActive: updated.isActive,
      isFeatured: updated.isFeatured,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
