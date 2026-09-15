import { z } from "zod";

export const forgotPasswordSchema = z.object({
  email: z.email(),
});

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
