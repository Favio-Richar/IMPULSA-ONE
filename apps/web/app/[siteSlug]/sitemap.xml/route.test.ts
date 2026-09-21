import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSiteResponse } from "@impulza/contracts";

vi.mock("../../../lib/api.js", () => ({ getPublicSite: vi.fn() }));
vi.mock("../../../lib/env.js", () => ({ env: { PUBLIC_WEB_BASE_URL: "https://impulza.test" } }));

const { getPublicSite } = await import("../../../lib/api.js");
const { GET } = await import("./route.js");

const params = (siteSlug: string) => ({ params: Promise.resolve({ siteSlug }) });

describe("GET /:siteSlug/sitemap.xml (F2.8)", () => {
  beforeEach(() => {
    vi.mocked(getPublicSite).mockReset();
  });

  it("404 si el sitio no existe o no es alcanzable — mismo criterio que el render de sus páginas", async () => {
    vi.mocked(getPublicSite).mockResolvedValue(null);
    const response = await GET(new Request("https://impulza.test/no-existe/sitemap.xml"), params("no-existe"));
    expect(response.status).toBe(404);
  });

  it("lista solo las páginas PUBLIC y publicadas, con su lastmod real", async () => {
    const site: PublicSiteResponse = {
      name: "Mi Sitio",
      slug: "mi-sitio",
      theme: { tokens: {} },
      pages: [
        { slug: "inicio", isHome: true, publishedAt: "2026-01-01T00:00:00.000Z" },
        { slug: "servicios", isHome: false, publishedAt: "2026-02-01T00:00:00.000Z" },
      ],
    };
    vi.mocked(getPublicSite).mockResolvedValue(site);

    const response = await GET(new Request("https://impulza.test/mi-sitio/sitemap.xml"), params("mi-sitio"));
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/xml");
    expect(body).toContain("<loc>https://impulza.test/mi-sitio</loc>");
    expect(body).toContain("<loc>https://impulza.test/mi-sitio/servicios</loc>");
    expect(body).toContain("<lastmod>2026-02-01T00:00:00.000Z</lastmod>");
    expect(body.match(/<url>/g)).toHaveLength(2);
  });

  it("escapa caracteres reservados de XML en la URL (defensa en profundidad)", async () => {
    // Un slug real nunca lleva "&" (`slugSchema` solo admite minúsculas, dígitos y guiones); esto
    // prueba que `escapeXml` sí se aplica en el punto de uso, sin confiar en que el dato de
    // entrada ya viene limpio, sea cual sea su origen.
    const site: PublicSiteResponse = {
      name: "Mi Sitio",
      slug: "mi&sitio",
      theme: { tokens: {} },
      pages: [{ slug: "inicio", isHome: true, publishedAt: "2026-01-01T00:00:00.000Z" }],
    };
    vi.mocked(getPublicSite).mockResolvedValue(site);

    const response = await GET(new Request("https://impulza.test/mi-sitio/sitemap.xml"), params("mi-sitio"));
    const body = await response.text();
    expect(body).not.toContain("<loc>https://impulza.test/mi&sitio</loc>");
    expect(body).toContain("<loc>https://impulza.test/mi&amp;sitio</loc>");
  });
});
