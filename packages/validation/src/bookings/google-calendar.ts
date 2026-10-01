import { z } from "zod";

export const googleCalendarAuthUrlQuerySchema = z.object({
  redirectUri: z.string().url("URI de redirección inválida."),
  staffId: z.string().uuid("ID de profesional inválido.").optional(),
});
export type GoogleCalendarAuthUrlQuery = z.infer<typeof googleCalendarAuthUrlQuerySchema>;

// El profesional al que se vincula la cuenta viaja dentro del `state` firmado, no en el cuerpo: así no
// se puede cambiar entre el inicio de la autorización y su cierre.
export const connectGoogleCalendarSchema = z.object({
  code: z.string().min(1, "El código de autorización es obligatorio.").max(2048),
  state: z.string().min(1, "Falta el estado de la autorización.").max(4096),
  redirectUri: z.string().url("URI de redirección inválida."),
});
export type ConnectGoogleCalendarInput = z.infer<typeof connectGoogleCalendarSchema>;

export const disconnectGoogleCalendarSchema = z.object({
  staffId: z.string().uuid("ID de profesional inválido.").optional(),
});
export type DisconnectGoogleCalendarInput = z.infer<typeof disconnectGoogleCalendarSchema>;
