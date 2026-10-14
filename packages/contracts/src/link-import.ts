import { z } from "zod";

/** Importar enlaces desde una página de «enlace en bio» ya existente (onboarding, paso 6). */
export const linkImportRequest = z.object({ url: z.string().trim().min(4).max(300) });
export type LinkImportRequest = z.infer<typeof linkImportRequest>;

export const linkImportResponse = z.object({
  /** Plataforma reconocida por su dominio (lista cerrada). */
  source: z.enum(["linktree", "beacons", "biolink", "other"]),
  title: z.string().nullable(),
  /** Perfiles de redes sociales detectados por su dominio. */
  socials: z.array(z.string()),
  /** Enlaces propios (texto + destino). */
  links: z.array(z.object({ label: z.string(), url: z.string() })),
});
export type LinkImportResponse = z.infer<typeof linkImportResponse>;
