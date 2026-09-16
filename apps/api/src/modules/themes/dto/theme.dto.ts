import { z } from "zod";

// `tokens` llega como `unknown` a propósito y se valida en el servicio contra `themeTokensSchema`
// (mismo patrón que la configuración de bloques en F2.4). Dos razones: el esquema de tokens no es
// solo de forma —comprueba contraste WCAG entre pares de colores— y queremos que ese fallo salga
// como 422 con el campo exacto ("palette.mutedForeground"), no como un 400 genérico de entrada.
const themeNameSchema = z.string().trim().min(2).max(60);

export const createThemeSchema = z.object({
  name: themeNameSchema,
  tokens: z.unknown(),
});

export const updateThemeSchema = z
  .object({
    name: themeNameSchema.optional(),
    // Los tokens se envían completos, nunca a medias: un parche parcial de paleta no se puede
    // verificar contra AA sin volver a leer lo guardado, y un tema a medio validar es justo lo
    // que este esquema existe para impedir.
    tokens: z.unknown().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Envía al menos un campo a modificar.",
  });

export const duplicateThemeSchema = z.object({
  name: themeNameSchema.optional(),
});

// `null` devuelve el sitio al tema por defecto del catálogo — es un valor válido, no un campo
// ausente, así que el cliente tiene que enviarlo explícitamente.
export const assignThemeSchema = z.object({
  themeId: z.uuid().nullable(),
});

export type CreateThemeDto = z.infer<typeof createThemeSchema>;
export type UpdateThemeDto = z.infer<typeof updateThemeSchema>;
export type DuplicateThemeDto = z.infer<typeof duplicateThemeSchema>;
export type AssignThemeDto = z.infer<typeof assignThemeSchema>;
