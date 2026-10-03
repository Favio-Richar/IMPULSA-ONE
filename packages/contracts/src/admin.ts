import { z } from "zod";
import { organizationStatus } from "./organizations.js";
import { planResponse, planUsageResponse } from "./plans.js";
import { isoDateTime, uuid } from "./primitives.js";

// Superadministración de la plataforma (F4.4, ADR-005). Solo metadatos de la plataforma: ninguna
// de estas respuestas lleva contactos, envíos de formularios, contenido de páginas ni analítica de
// visitantes de una organización (ADR-005 §5).

export const adminIdentityResponse = z.object({
  id: uuid,
  email: z.email(),
});

export const adminLoginResponse = z.object({
  admin: adminIdentityResponse,
  /** Cuándo vence la sesión de administración (8 h, sin renovación). */
  expiresAt: isoDateTime,
});

export const adminOverviewResponse = z.object({
  totals: z.object({
    users: z.number().int(),
    organizations: z.number().int(),
    blockedOrganizations: z.number().int(),
    publishedSites: z.number().int(),
    /** Solicitudes de soporte que esperan respuesta del equipo (F4.5). */
    openSupportTickets: z.number().int(),
  }),
  /** Altas por día de los últimos 30 días (usuarios y organizaciones), del más antiguo al más nuevo. */
  signups: z.array(z.object({ day: z.string(), users: z.number().int(), organizations: z.number().int() })),
  /** Organizaciones por plan efectivo. */
  planDistribution: z.array(z.object({ planCode: z.string(), planName: z.string(), organizations: z.number().int() })),
  recentOrganizations: z.array(
    z.object({ id: uuid, name: z.string(), slug: z.string(), status: organizationStatus, createdAt: isoDateTime }),
  ),
});

export const adminOrganizationSummaryResponse = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  status: organizationStatus,
  planCode: z.string(),
  planName: z.string(),
  members: z.number().int(),
  sites: z.number().int(),
  createdAt: isoDateTime,
});

/** Página de resultados: `total` es el conteo con el filtro aplicado, para paginar. */
export const adminOrganizationListResponse = z.object({
  items: z.array(adminOrganizationSummaryResponse),
  total: z.number().int(),
});

export const adminOrganizationDetailResponse = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  status: organizationStatus,
  blockedAt: isoDateTime.nullable(),
  blockedReason: z.string().nullable(),
  createdAt: isoDateTime,
  plan: planResponse,
  planSource: z.enum(["subscription", "assigned", "agency", "default"]),
  usage: planUsageResponse,
  members: z.array(
    z.object({
      membershipId: uuid,
      email: z.email(),
      role: z.string(),
      status: z.enum(["INVITED", "ACTIVE", "SUSPENDED", "REMOVED"]),
    }),
  ),
  sites: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      slug: z.string(),
      status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
      /** Se sirve de verdad: no archivado y con al menos una página publicada (`status` no lo dice). */
      live: z.boolean(),
    }),
  ),
  /** Su suscripción de pago y sus últimos cobros (F4.6d): lo que paga a Impulza, no datos de sus clientes. */
  billing: z.object({
    subscription: z
      .object({
        status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "INCOMPLETE"]),
        planName: z.string(),
        cycle: z.enum(["MONTHLY", "YEARLY"]),
        currentPeriodEnd: isoDateTime,
        cancelAtPeriodEnd: z.boolean(),
        nextChargeAt: isoDateTime.nullable(),
        failedAttempts: z.number().int(),
        cardLast4: z.string().nullable(),
      })
      .nullable(),
    recentPayments: z.array(
      z.object({
        id: uuid,
        amount: z.number().int(),
        status: z.enum(["PENDING", "APPROVED", "REJECTED", "REFUNDED"]),
        taxDocumentStatus: z.enum(["PENDING", "ISSUED", "NOT_REQUIRED"]),
        createdAt: isoDateTime,
      }),
    ),
  }),
});

export const adminUserSummaryResponse = z.object({
  id: uuid,
  email: z.email(),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  isSuperAdmin: z.boolean(),
  organizations: z.number().int(),
  createdAt: isoDateTime,
});

export const adminUserListResponse = z.object({
  items: z.array(adminUserSummaryResponse),
  total: z.number().int(),
});

export const adminAuditEntryResponse = z.object({
  id: uuid,
  action: z.string(),
  actorEmail: z.string().nullable(),
  organizationId: uuid.nullable(),
  organizationName: z.string().nullable(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoDateTime,
});

export const adminAuditListResponse = z.object({
  items: z.array(adminAuditEntryResponse),
  total: z.number().int(),
});

export type AdminIdentityResponse = z.infer<typeof adminIdentityResponse>;
export type AdminLoginResponse = z.infer<typeof adminLoginResponse>;
export type AdminOverviewResponse = z.infer<typeof adminOverviewResponse>;
export type AdminOrganizationSummaryResponse = z.infer<typeof adminOrganizationSummaryResponse>;
export type AdminOrganizationListResponse = z.infer<typeof adminOrganizationListResponse>;
export type AdminOrganizationDetailResponse = z.infer<typeof adminOrganizationDetailResponse>;
export type AdminUserSummaryResponse = z.infer<typeof adminUserSummaryResponse>;
export type AdminUserListResponse = z.infer<typeof adminUserListResponse>;
export type AdminAuditEntryResponse = z.infer<typeof adminAuditEntryResponse>;
export type AdminAuditListResponse = z.infer<typeof adminAuditListResponse>;

// F7.11 (ADR-026): Operación técnica, colas BullMQ, feature flags y plantillas

export const adminSystemHealthResponse = z.object({
  status: z.enum(["ok", "degraded", "error"]),
  database: z.object({
    status: z.enum(["ok", "error"]),
    latencyMs: z.number(),
    counts: z.object({
      users: z.number().int(),
      organizations: z.number().int(),
      sites: z.number().int(),
      bookings: z.number().int(),
      orders: z.number().int(),
    }),
    error: z.string().optional(),
  }),
  redis: z.object({
    status: z.enum(["ok", "error"]),
    latencyMs: z.number(),
    memoryUsedBytes: z.number().int().optional(),
    connectedClients: z.number().int().optional(),
    error: z.string().optional(),
  }),
  worker: z.object({
    status: z.enum(["ok", "down"]),
    latencyMs: z.number().optional(),
    error: z.string().optional(),
  }),
  storage: z.object({
    status: z.enum(["configured", "not_configured"]),
    provider: z.string(),
    bucket: z.string().optional(),
  }),
  gateways: z.object({
    webpay: z.object({
      configured: z.boolean(),
      mode: z.enum(["test", "production", "disabled"]),
    }),
    mercadoPago: z.object({
      configured: z.boolean(),
      mode: z.enum(["test", "production", "disabled"]),
    }),
  }),
  process: z.object({
    uptimeSeconds: z.number(),
    memory: z.object({
      heapUsedBytes: z.number().int(),
      heapTotalBytes: z.number().int(),
      rssBytes: z.number().int(),
    }),
    nodeVersion: z.string(),
  }),
});

export const adminQueueItemResponse = z.object({
  name: z.string(),
  displayName: z.string(),
  waiting: z.number().int(),
  active: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
  delayed: z.number().int(),
  paused: z.boolean(),
});

export const adminQueueMetricsResponse = z.object({
  queues: z.array(adminQueueItemResponse),
});

export const adminQueueActionResultResponse = z.object({
  success: z.boolean(),
  queueName: z.string(),
  action: z.string(),
  message: z.string().optional(),
});

export const adminFeatureFlagResponse = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  rules: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const adminFeatureFlagListResponse = z.object({
  items: z.array(adminFeatureFlagResponse),
  total: z.number().int(),
});

export const adminTemplateSummaryResponse = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  description: z.string(),
  industryTags: z.array(z.string()),
  objectiveTags: z.array(z.string()),
  themeCode: z.string(),
  family: z.string(),
  previewImageUrl: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const adminTemplateListResponse = z.object({
  items: z.array(adminTemplateSummaryResponse),
  total: z.number().int(),
});

export type AdminSystemHealthResponse = z.infer<typeof adminSystemHealthResponse>;
export type AdminQueueItemResponse = z.infer<typeof adminQueueItemResponse>;
export type AdminQueueMetricsResponse = z.infer<typeof adminQueueMetricsResponse>;
export type AdminQueueActionResultResponse = z.infer<typeof adminQueueActionResultResponse>;
export type AdminFeatureFlagResponse = z.infer<typeof adminFeatureFlagResponse>;
export type AdminFeatureFlagListResponse = z.infer<typeof adminFeatureFlagListResponse>;
export type AdminTemplateSummaryResponse = z.infer<typeof adminTemplateSummaryResponse>;
export type AdminTemplateListResponse = z.infer<typeof adminTemplateListResponse>;
