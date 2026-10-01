import { z } from "zod";
import { phoneSchema, plainTextSchema, safeUrlSchema } from "../blocks/primitives.js";
import { weeklyHoursSchema } from "./weekly-hours.js";

// F7.9a (ADR-024): Sucursales y profesionales para reservas multi-recurso.

export const MAX_BRANCHES_PER_SITE = 20;
export const MAX_STAFF_PER_SITE = 50;

/** Sucursal de atención del negocio (F7.9a). */
export const bookingBranchSchema = z.object({
  name: plainTextSchema(120),
  address: plainTextSchema(200).optional(),
  phone: phoneSchema.optional(),
  active: z.boolean().default(true),
  position: z.number().int().min(0).max(10_000).optional(),
});
export type BookingBranchInput = z.infer<typeof bookingBranchSchema>;

export const updateBookingBranchSchema = z
  .object({
    name: plainTextSchema(120),
    address: plainTextSchema(200).nullable(),
    phone: phoneSchema.nullable(),
    active: z.boolean(),
    position: z.number().int().min(0).max(10_000),
  })
  .partial();
export type UpdateBookingBranchInput = z.infer<typeof updateBookingBranchSchema>;

/** Profesional o prestador de atención (F7.9a). */
export const bookingStaffSchema = z.object({
  name: plainTextSchema(120),
  title: plainTextSchema(120).optional(),
  email: z.string().email("Escribe un correo válido.").max(254).optional(),
  phone: phoneSchema.optional(),
  avatarUrl: safeUrlSchema.optional(),
  branchId: z.string().uuid().optional(),
  active: z.boolean().default(true),
  position: z.number().int().min(0).max(10_000).optional(),
  /** Si se define, usa sus propios horarios en vez de los del sitio. */
  weeklyHours: weeklyHoursSchema.optional(),
  /** IDs de servicios que puede atender. Vacío o ausente = atiende todos los del sitio. */
  serviceIds: z.array(z.string().uuid()).max(100).optional(),
});
export type BookingStaffInput = z.infer<typeof bookingStaffSchema>;

export const updateBookingStaffSchema = z
  .object({
    name: plainTextSchema(120),
    title: plainTextSchema(120).nullable(),
    email: z.string().email("Escribe un correo válido.").max(254).nullable(),
    phone: phoneSchema.nullable(),
    avatarUrl: safeUrlSchema.nullable(),
    branchId: z.string().uuid().nullable(),
    active: z.boolean(),
    position: z.number().int().min(0).max(10_000),
    weeklyHours: weeklyHoursSchema.nullable(),
    serviceIds: z.array(z.string().uuid()).max(100).optional(),
  })
  .partial();
export type UpdateBookingStaffInput = z.infer<typeof updateBookingStaffSchema>;

/** Asignación de profesionales a un servicio (F7.9a). */
export const assignStaffToServiceSchema = z.object({
  staffIds: z.array(z.string().uuid()).max(MAX_STAFF_PER_SITE),
});
export type AssignStaffToServiceInput = z.infer<typeof assignStaffToServiceSchema>;
