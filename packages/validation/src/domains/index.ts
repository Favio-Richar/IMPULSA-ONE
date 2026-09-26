import { z } from "zod";

// Dominios propios (F4.7). Esquema compartido: el panel lo usa para avisar antes de enviar y la API
// lo vuelve a aplicar (ST §15). Solo se acepta un nombre de host público en ASCII: nada de IPs,
// puertos, rutas ni nombres de redes internas — la verificación consulta DNS con este nombre, y un
// host interno sería una puerta a SSRF.

/** Subdominio donde el cliente crea el registro TXT de verificación: `_impulza.<dominio>`. */
export const DOMAIN_VERIFICATION_PREFIX = "_impulza";
/** Prefijo del valor del TXT: `impulza-verificacion=<token>`. */
export const DOMAIN_VERIFICATION_VALUE_PREFIX = "impulza-verificacion=";
/** Dominios por sitio (tope técnico; un límite por plan es la decisión #4 del propietario). */
export const MAX_DOMAINS_PER_SITE = 5;

/** Códigos estables del último fallo de verificación (se guardan; nunca texto del resolvedor). */
export const DOMAIN_CHECK_ERRORS = ["TXT_NOT_FOUND", "TXT_MISMATCH", "DNS_TIMEOUT", "DNS_ERROR"] as const;
export type DomainCheckError = (typeof DOMAIN_CHECK_ERRORS)[number];

export const DOMAIN_CHECK_ERROR_MESSAGES: Record<DomainCheckError, string> = {
  TXT_NOT_FOUND: "Todavía no encontramos el registro TXT. Los cambios de DNS pueden tardar hasta 48 horas.",
  TXT_MISMATCH: "Encontramos un registro TXT, pero su valor no coincide. Cópialo de nuevo, sin espacios.",
  DNS_TIMEOUT: "El DNS del dominio no respondió a tiempo. Vuelve a intentarlo en unos minutos.",
  DNS_ERROR: "No pudimos consultar el DNS del dominio. Revisa que el dominio exista y vuelve a intentarlo.",
};

/**
 * Terminaciones que nunca son un dominio público: redes internas, pruebas y documentación
 * (RFC 6761, RFC 6762, RFC 2606, `.internal` de ICANN, `.arpa` incluye `home.arpa`).
 */
const RESERVED_SUFFIXES = ["localhost", "local", "internal", "intranet", "lan", "home", "corp", "test", "example", "invalid", "arpa", "onion"];

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Normaliza lo que escribe una persona: sin espacios, en minúsculas, sin punto final y, si pegó
 * una dirección entera (`https://www.mi-sitio.cl/`), solo el nombre de host. Un nombre con acentos
 * pasa a punycode con el mismo algoritmo que usa el navegador (`URL`).
 */
export function normalizeDomainInput(value: string): string {
  let candidate = value.trim().toLowerCase();
  candidate = candidate.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  candidate = candidate.split(/[/?#]/, 1)[0] ?? "";
  candidate = candidate.replace(/\.$/, "");
  // Espacios, credenciales (`@`), puertos (`:`), IPv6 entre corchetes y barras invertidas: no es un
  // nombre de host; se devuelve tal cual para que la validación lo rechace.
  if (candidate === "" || /[\s@:\\[\]]/.test(candidate)) {
    return candidate;
  }
  try {
    return new URL(`http://${candidate}`).hostname.replace(/\.$/, "");
  } catch {
    return candidate;
  }
}

/** `true` si el nombre de host es público y bien formado (ya normalizado). */
export function isPublicHostname(hostname: string): boolean {
  if (hostname.length > 253) {
    return false;
  }
  const labels = hostname.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) {
    return false;
  }
  const tld = labels[labels.length - 1]!;
  if (!TLD.test(tld)) {
    return false; // incluye cualquier IPv4 (su última parte es un número)
  }
  return !RESERVED_SUFFIXES.includes(tld);
}

/** Dominio propio: se normaliza y se exige un nombre de host público. */
export const customDomainSchema = z
  .string()
  .max(300)
  .transform(normalizeDomainInput)
  .refine(isPublicHostname, {
    message: "Escribe un dominio público, por ejemplo mi-negocio.cl o www.mi-negocio.cl (sin https:// ni rutas).",
  });

export const createSiteDomainSchema = z.object({ domain: customDomainSchema });
export type CreateSiteDomainInput = z.infer<typeof createSiteDomainSchema>;

/** Nombre y valor del TXT que el cliente debe crear. */
export function domainVerificationRecord(domain: string, token: string): { name: string; value: string } {
  return { name: `${DOMAIN_VERIFICATION_PREFIX}.${domain}`, value: `${DOMAIN_VERIFICATION_VALUE_PREFIX}${token}` };
}

/** `true` si `hostname` es `base` o un subdominio suyo (para no dejar reclamar la plataforma). */
export function isSameOrSubdomain(hostname: string, base: string): boolean {
  return hostname === base || hostname.endsWith(`.${base}`);
}
