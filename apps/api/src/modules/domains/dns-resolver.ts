import { Resolver } from "node:dns/promises";
import type { DomainCheckError } from "@impulza/validation";

/** Token de inyección del resolvedor DNS (las pruebas lo reemplazan: nunca salen a internet). */
export const DOMAIN_DNS_RESOLVER = Symbol("DOMAIN_DNS_RESOLVER");

/** Resultado de buscar los TXT de un nombre: los valores, o un código estable de fallo. */
export type TxtLookup = { ok: true; values: string[] } | { ok: false; error: Exclude<DomainCheckError, "TXT_MISMATCH"> };

export interface DomainDnsResolver {
  lookupTxt(name: string): Promise<TxtLookup>;
}

const TIMEOUT_MS = 4000;

/**
 * Resolvedor real (F4.7). **Solo DNS**: la verificación nunca hace una petición HTTP al dominio del
 * cliente (sin superficie de SSRF), y el nombre que se consulta ya pasó `customDomainSchema` (host
 * público, sin IPs ni redes internas). Tiempo acotado: un DNS que no responde no retiene la petición.
 */
export class NodeDomainDnsResolver implements DomainDnsResolver {
  async lookupTxt(name: string): Promise<TxtLookup> {
    const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 1 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<TxtLookup>((resolve) => {
      timer = setTimeout(() => {
        resolver.cancel();
        resolve({ ok: false, error: "DNS_TIMEOUT" });
      }, TIMEOUT_MS + 500);
    });
    const lookup = resolver
      .resolveTxt(name)
      .then((records): TxtLookup => ({ ok: true, values: records.map((chunks) => chunks.join("")) }))
      .catch((error: NodeJS.ErrnoException): TxtLookup => {
        if (error.code === "ENODATA" || error.code === "ENOTFOUND") {
          return { ok: false, error: "TXT_NOT_FOUND" };
        }
        if (error.code === "ETIMEOUT" || error.code === "ECANCELLED") {
          return { ok: false, error: "DNS_TIMEOUT" };
        }
        return { ok: false, error: "DNS_ERROR" };
      });
    try {
      return await Promise.race([lookup, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
