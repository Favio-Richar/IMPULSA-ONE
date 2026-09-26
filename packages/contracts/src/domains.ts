import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

/**
 * Dominio propio de un sitio (F4.7). `verification` es el registro TXT que el cliente crea en su
 * DNS para probar que el dominio es suyo; `cnameTarget`, a dónde apuntar el dominio una vez
 * verificado (`null` mientras la instalación no tenga dominio de plataforma configurado, decisión #1).
 */
export const siteDomainResponse = z.object({
  id: uuid,
  siteId: uuid,
  domain: z.string(),
  status: z.enum(["PENDING", "VERIFIED", "FAILED"]),
  /** La emisión del certificado depende del hosting (F4.8): hasta entonces, `PENDING`. */
  sslStatus: z.enum(["PENDING", "ACTIVE", "FAILED"]),
  verification: z.object({ name: z.string(), value: z.string() }),
  cnameTarget: z.string().nullable(),
  /** Código estable del último fallo (`DOMAIN_CHECK_ERRORS`), o `null`. */
  lastCheckError: z.enum(["TXT_NOT_FOUND", "TXT_MISMATCH", "DNS_TIMEOUT", "DNS_ERROR"]).nullable(),
  lastCheckedAt: isoDateTime.nullable(),
  verifiedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type SiteDomainResponse = z.infer<typeof siteDomainResponse>;

/** Resolución pública de un dominio verificado (la usa el `proxy` de `apps/web`): solo el slug. */
export const publicDomainResolution = z.object({ siteSlug: z.string() });
export type PublicDomainResolution = z.infer<typeof publicDomainResolution>;
