import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSiteResponse } from "@impulza/contracts";

vi.mock("../../../lib/api.js", () => ({ getPublicSite: vi.fn() }));
vi.mock("../../../lib/env.js", () => ({ env: { PUBLIC_WEB_BASE_URL: "https://impulza.test" } }));

const { getPublicSite } = await import("../../../lib/api.js");
const { GET } = await import("./route.js");

const params = (siteSlug: string) => ({ params: Promise.resolve({ siteSlug }) });

describe("GET /:siteSlug/robots.txt (F2.8)", () => {
  beforeEach(() => {
    vi.mocked(getPublicSite).mockReset();
  });

  it("404 si el sitio no existe o no es alcanzable", async () => {
    vi.mocked(getPublicSite).mockResolvedValue(null);
    const response = await GET(new Request("https://impulza.test/no-existe/robots.txt"), params("no-existe"));
    expect(response.status).toBe(404);
  });

  it("permite todo y apunta al sitemap propio del sitio", async () => {
    const site: PublicSiteResponse = {
      name: "Mi Sitio",
      slug: "mi-sitio",
      theme: { tokens: {} },
    background: null,
      pages: [],
    };
    vi.mocked(getPublicSite).mockResolvedValue(site);

    const response = await GET(new Request("https://impulza.test/mi-sitio/robots.txt"), params("mi-sitio"));
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("Allow: /");
    expect(body).toContain("Sitemap: https://impulza.test/mi-sitio/sitemap.xml");
  });
});
