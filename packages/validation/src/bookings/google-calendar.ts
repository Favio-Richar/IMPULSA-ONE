import { z } from "zod";

export const googleCalendarAuthUrlQuerySchema = z.object({
  redirectUri: z.string().url("URI de redirección inválida."),
  staffId: z.string().uuid("ID de profesional inválido.").optional(),
});
export type GoogleCalendarAuthUrlQuery = z.infer<typeof googleCalendarAuthUrlQuerySchema>;

export const connectGoogleCalendarSchema = z.object({
  code: z.string().min(1, "El código de autorización es obligatorio."),
  redirectUri: z.string().url("URI de redirección inválida."),
  staffId: z.string().uuid("ID de profesional inválido.").optional(),
});
export type ConnectGoogleCalendarInput = z.infer<typeof connectGoogleCalendarSchema>;

export const disconnectGoogleCalendarSchema = z.object({
  staffId: z.string().uuid("ID de profesional inválido.").optional(),
});
export type DisconnectGoogleCalendarInput = z.infer<typeof disconnectGoogleCalendarSchema>;
