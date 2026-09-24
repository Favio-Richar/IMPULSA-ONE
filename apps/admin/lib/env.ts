import { z } from "zod";

// Next.js inlina NEXT_PUBLIC_* en build time; se valida igual de estricto que en apps/dashboard.
const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
});

export const env = clientEnvSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});
