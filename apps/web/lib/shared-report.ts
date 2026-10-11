import { publicReportResponse, type PublicReportResponse } from "@impulza/contracts";
import { env } from "./env";
import { fetchUpstream } from "./upstream";

/**
 * Informe compartido por enlace (F9.8b, ADR-028 §6), del lado del servidor y sin caché: el enlace es una credencial y vence o se revoca.
 * - `null`: enlace desconocido o mal formado (404);
 * - `"gone"`: revocado o vencido (410);
 * - `"unavailable"`: la API no respondió bien.
 */
export async function getSharedReport(token: string): Promise<PublicReportResponse | null | "gone" | "unavailable"> {
  const response = await fetchUpstream("shared-report", `${env.API_BASE_URL}/public/reports/${encodeURIComponent(token)}`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response) return "unavailable";
  if (response.status === 404) return null;
  if (response.status === 410) return "gone";
  if (!response.ok) return "unavailable";
  return publicReportResponse.parse(await response.json());
}

/** El CSV del mismo enlace (con sus mismos 404 y 410), para servirlo como descarga desde este mismo origen. */
export async function getSharedReportCsv(token: string): Promise<{ status: number; body: string }> {
  const response = await fetchUpstream("shared-report", `${env.API_BASE_URL}/public/reports/${encodeURIComponent(token)}/csv`, {
    headers: { "X-Requested-With": "impulza-one" },
    cache: "no-store",
  });
  if (!response) return { status: 503, body: "" };
  if (!response.ok) return { status: response.status === 404 || response.status === 410 ? response.status : 503, body: "" };
  // `text()` descarta el BOM: se decodifican los bytes conservándolo para que Excel respete las tildes.
  return { status: 200, body: new TextDecoder("utf-8", { ignoreBOM: true }).decode(await response.arrayBuffer()) };
}
