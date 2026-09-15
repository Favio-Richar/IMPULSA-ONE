import { z } from "zod";

// Next.js inlina las variables NEXT_PUBLIC_* en el bundle de cliente en build time — no puede
// pasar por packages/config (pensado para Node puro), pero se valida igual de estricto.
const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
});

export const env = clientEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
