import { z } from "zod";

export const twoFactorCodeSchema = z.object({
  code: z.string().length(6),
});

export type TwoFactorCodeDto = z.infer<typeof twoFactorCodeSchema>;
