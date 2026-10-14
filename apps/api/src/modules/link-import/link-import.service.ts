import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { LinkImportResponse } from "@impulza/contracts";
import { parseLinkInBio } from "./link-in-bio-parser.js";

/** Solo estas plataformas (lista cerrada): el servidor nunca descarga una URL arbitraria (sin superficie de SSRF). */
const SOURCES: ReadonlyArray<{ source: LinkImportResponse["source"]; hosts: readonly string[] }> = [
  { source: "linktree", hosts: ["linktr.ee"] },
  { source: "beacons", hosts: ["beacons.ai"] },
  { source: "biolink", hosts: ["bio.link"] },
];

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 7000;
const MAX_REDIRECTS = 2;

export type LinkImportFetch = (url: string) => Promise<{ status: number; location: string | null; body: string }>;

/** Descarga real: https, sin seguir redirecciones solos, con tiempo y tamaño acotados. */
export const realLinkImportFetch: LinkImportFetch = async (url) => {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "text/html", "user-agent": "ImpulzaOneImporter/1.0" },
  });
  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400) {
    return { status: response.status, location, body: "" };
  }
  const reader = response.body?.getReader();
  let received = 0;
  const chunks: Uint8Array[] = [];
  while (reader) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { status: response.status, location: null, body: Buffer.concat(chunks).toString("utf8") };
};

function resolveSource(rawUrl: string): { url: string; source: LinkImportResponse["source"]; host: string } {
  const normalized = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new UnprocessableEntityException({ code: "LINK_IMPORT_INVALID_URL", message: "Pega la dirección completa de tu página." });
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const match = SOURCES.find((entry) => entry.hosts.includes(host));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !match) {
    throw new UnprocessableEntityException({
      code: "LINK_IMPORT_UNSUPPORTED_SOURCE",
      message: "Por ahora podemos importar desde Linktree (linktr.ee), Beacons (beacons.ai) y Bio.link.",
    });
  }
  return { url: `https://${host}${parsed.pathname}`, source: match.source, host };
}

@Injectable()
export class LinkImportService {
  /** Sustituible en pruebas: nunca salen a internet. */
  fetcher: LinkImportFetch = realLinkImportFetch;

  async importFrom(rawUrl: string): Promise<LinkImportResponse> {
    const { url, source, host } = resolveSource(rawUrl);
    let current = url;
    let body = "";
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const result = await this.fetcher(current);
        if (result.status >= 300 && result.status < 400 && result.location) {
          const next = new URL(result.location, current);
          // Solo se sigue una redirección que se queda en la misma plataforma.
          if (next.protocol !== "https:" || next.hostname.replace(/^www\./, "") !== host) {
            throw new UnprocessableEntityException({ code: "LINK_IMPORT_UNSUPPORTED_SOURCE", message: "La página redirige fuera de la plataforma." });
          }
          current = next.toString();
          continue;
        }
        if (result.status === 404) {
          throw new UnprocessableEntityException({ code: "LINK_IMPORT_NOT_FOUND", message: "No encontramos esa página. Revisa la dirección." });
        }
        if (result.status !== 200) {
          throw new UnprocessableEntityException({ code: "LINK_IMPORT_FAILED", message: "No pudimos leer esa página ahora. Intenta de nuevo." });
        }
        body = result.body;
        break;
      }
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }
      throw new UnprocessableEntityException({ code: "LINK_IMPORT_FAILED", message: "No pudimos leer esa página ahora. Intenta de nuevo." });
    }
    const parsed = parseLinkInBio(body, host);
    if (parsed.socials.length === 0 && parsed.links.length === 0) {
      throw new UnprocessableEntityException({
        code: "LINK_IMPORT_EMPTY",
        message: "No encontramos enlaces en esa página. Puedes agregarlos a mano.",
      });
    }
    return { source, ...parsed };
  }
}
