import { z } from "zod";

// `background` llega como `unknown` y se valida en el servicio contra `siteBackgroundSchema`, igual
// que los tokens de un tema: el esquema no es solo de forma (verifica contraste AA) y el fallo debe
// salir como 422 con el campo exacto, no como un 400 genérico. `null` = volver al fondo del tema.
export const setSiteBackgroundSchema = z.object({
  background: z.unknown().refine((value) => value !== undefined, { message: "Envía `background` (o `null` para usar el del tema)." }),
});

export type SetSiteBackgroundDto = z.infer<typeof setSiteBackgroundSchema>;
