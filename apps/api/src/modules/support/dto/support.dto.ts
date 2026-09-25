import { z } from "zod";

// Texto plano: se muestra como texto (React escapa), nunca como HTML. El asunto además viaja en el
// asunto de un correo, así que no admite saltos de línea ni caracteres de control (inyección de
// cabeceras).
const subject = z
  .string()
  .trim()
  .min(5, "El asunto necesita al menos 5 caracteres.")
  .max(120, "El asunto admite hasta 120 caracteres.")
  // eslint-disable-next-line no-control-regex
  .regex(/^[^\u0000-\u001f\u007f]+$/, "El asunto no puede tener saltos de línea.");

const body = z.string().trim().min(10, "Cuéntanos un poco más (al menos 10 caracteres).").max(5000, "El mensaje admite hasta 5.000 caracteres.");

export const createSupportTicketSchema = z.object({ subject, body });
export type CreateSupportTicketDto = z.infer<typeof createSupportTicketSchema>;

export const supportMessageSchema = z.object({ body });
export type SupportMessageDto = z.infer<typeof supportMessageSchema>;

export const listAdminSupportTicketsQuerySchema = z.object({
  status: z.enum(["OPEN", "ANSWERED", "CLOSED"]).optional(),
  organizationId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListAdminSupportTicketsQueryDto = z.infer<typeof listAdminSupportTicketsQuerySchema>;
