import { z } from "zod";

const page = z.coerce.number().int().min(1).max(10_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);

export const listAdminOrganizationsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  page,
  pageSize,
});
export type ListAdminOrganizationsQueryDto = z.infer<typeof listAdminOrganizationsQuerySchema>;

export const listAdminUsersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page,
  pageSize,
});
export type ListAdminUsersQueryDto = z.infer<typeof listAdminUsersQuerySchema>;

export const listAdminAuditQuerySchema = z.object({
  /** Solo acciones de superadministración (`admin.*`) o toda la auditoría de la plataforma. */
  scope: z.enum(["admin", "all"]).default("admin"),
  organizationId: z.uuid().optional(),
  page,
  pageSize,
});
export type ListAdminAuditQueryDto = z.infer<typeof listAdminAuditQuerySchema>;

export const uuidParamSchema = z.uuid();
