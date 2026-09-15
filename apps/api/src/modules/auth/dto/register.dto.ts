import { z } from "zod";

// Mínimo 8 caracteres (NIST SP 800-63B) — sin reglas de composición arbitrarias, que la
// evidencia muestra que empeoran la seguridad real de las contraseñas elegidas.
export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

export type RegisterDto = z.infer<typeof registerSchema>;
