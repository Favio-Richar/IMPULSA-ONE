import type { SiteResponse } from "@impulza/contracts";
import { describe, expect, it } from "vitest";
import { domainBadge, isSiteSortKey, siteUsage, sitePublicUrl, sortSites, suggestCopyName, suggestCopySlug } from "./site-card";

const site = (id: string, name: string, createdAt: string): SiteResponse => ({
  id,
  organizationId: "00000000-0000-4000-8000-000000000000",
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  status: "DRAFT",
  themeId: null,
  createdAt,
  updatedAt: createdAt,
});

describe("vista de sitios", () => {
  it("la URL pública prefiere el dominio verificado y si no, base/slug sin barras dobles", () => {
    expect(sitePublicUrl("http://localhost:3300/", "cafe")).toBe("http://localhost:3300/cafe");
    expect(sitePublicUrl("https://impulza.one", "cafe", "www.cafe.cl")).toBe("https://www.cafe.cl");
  });

  it("el estado del dominio: verificado gana, un dominio sin verificar es pendiente, sin dominio es «ninguno»", () => {
    expect(domainBadge([])).toEqual({ kind: "none", domain: null });
    expect(domainBadge([{ domain: "a.cl", status: "PENDING" }])).toEqual({ kind: "pending", domain: "a.cl" });
    expect(domainBadge([{ domain: "a.cl", status: "FAILED" }])).toEqual({ kind: "pending", domain: "a.cl" });
    expect(domainBadge([{ domain: "a.cl", status: "PENDING" }, { domain: "b.cl", status: "VERIFIED" }])).toEqual({ kind: "verified", domain: "b.cl" });
  });

  it("ordena por reciente, nombre y visitas sin mutar la lista, y los sitios sin dato van al final", () => {
    const sites = [site("a", "Beta", "2026-01-01T00:00:00Z"), site("b", "alfa", "2026-03-01T00:00:00Z"), site("c", "Gamma", "2026-02-01T00:00:00Z")];
    const original = [...sites];
    const visits = new Map<string, number | undefined>([["a", 50], ["b", 10], ["c", undefined]]);
    expect(sortSites(sites, "recent", visits).map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(sortSites(sites, "name", visits).map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(sortSites(sites, "visits", visits).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(sites).toEqual(original);
    expect(isSiteSortKey("visits")).toBe(true);
    expect(isSiteSortKey("otro")).toBe(false);
  });

  it("sugiere nombre y slug de la copia, evitando los ocupados y respetando el largo", () => {
    expect(suggestCopyName("Mi café")).toBe("Copia de Mi café");
    expect(suggestCopyName("x".repeat(200))).toHaveLength(120);
    expect(suggestCopySlug("cafe", [])).toBe("cafe-copia");
    expect(suggestCopySlug("cafe", ["cafe-copia", "cafe-copia-2"])).toBe("cafe-copia-3");
    const long = suggestCopySlug("a".repeat(63), []);
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith("-copia")).toBe(true);
  });

  it("el uso del plan: ilimitado, con cupo y en el límite", () => {
    expect(siteUsage(3, null)).toEqual({ used: 3, limit: null, reached: false, ratio: null });
    expect(siteUsage(1, 3)).toMatchObject({ reached: false, ratio: 1 / 3 });
    expect(siteUsage(3, 3)).toMatchObject({ reached: true, ratio: 1 });
    expect(siteUsage(5, 3)).toMatchObject({ reached: true, ratio: 1 });
  });
});
