import { z } from "zod";
import { brandProfileSchema, resolvedBrandSchema } from "@impulza/validation";

export const brandProfileResponse = brandProfileSchema;
export type BrandProfileResponse = z.infer<typeof brandProfileResponse>;

export const resolvedBrandResponse = resolvedBrandSchema;
export type ResolvedBrandResponse = z.infer<typeof resolvedBrandResponse>;

export const uploadBrandProfileAssetResponse = z.object({
  url: z.string().url(),
});
export type UploadBrandProfileAssetResponse = z.infer<typeof uploadBrandProfileAssetResponse>;
