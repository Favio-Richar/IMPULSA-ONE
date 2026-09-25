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
  planSource: z.enum(["subscription", "assigned", "default"]),
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
