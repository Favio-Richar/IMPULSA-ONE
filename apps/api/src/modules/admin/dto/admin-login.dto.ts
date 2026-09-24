import { z } from "zod";

// Los tres factores en una sola petición (ADR-005 §4): no hay un paso intermedio "contraseña
// correcta, falta el código" que confirme a un atacante que acertó la contraseña.
export const adminLoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "El código tiene 6 dígitos."),
});

export type AdminLoginDto = z.infer<typeof adminLoginSchema>;
