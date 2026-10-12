import { z } from "zod";
import { uuid } from "./primitives.js";

// F10: vistas y "me gusta" públicos de una página.

/** Lo que ve el visitante: cifras de la página y si este visitante ya le dio «me gusta». */
export const publicEngagementResponse = z.object({
  views: z.number().int().min(0),
  likes: z.number().int().min(0),
  liked: z.boolean(),
});
export type PublicEngagementResponse = z.infer<typeof publicEngagementResponse>;

/** Panel: cifras de cada página del sitio. */
export const siteEngagementResponse = z.object({
  pages: z.array(
    z.object({
      pageId: uuid,
      slug: z.string(),
      isHome: z.boolean(),
      views: z.number().int().min(0),
      likes: z.number().int().min(0),
    }),
  ),
  totals: z.object({ views: z.number().int().min(0), likes: z.number().int().min(0) }),
});
export type SiteEngagementResponse = z.infer<typeof siteEngagementResponse>;
