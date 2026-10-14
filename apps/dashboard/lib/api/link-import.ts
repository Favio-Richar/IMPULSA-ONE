import type { LinkImportResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

export function importLinkInBio(url: string): Promise<LinkImportResponse> {
  return apiFetch<LinkImportResponse>("/imports/link-in-bio", { method: "POST", body: { url } });
}
