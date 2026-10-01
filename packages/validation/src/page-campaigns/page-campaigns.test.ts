import { describe, expect, it } from "vitest";
import {
  createPageCampaignSchema,
  pageCampaignStatus,
  pageCampaignUrl,
  suggestUtmCampaign,
  updatePageCampaignSchema,
} from "./index.js";

const PAGE = "4f0b4d0e-7a8c-4b0e-9d7a-1f2e3d4c5b6a";
const valid = {
  name: "Cyber Día",
  objective: "vender",
  pageId: PAGE,
  startsAt: "2026-11-01T03:00:00.000Z",
  endsAt: "2026-11-04T03:00:00.000Z",
  utmCampaign: "cyber-dia",
};

function paths(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }): string[] {
  return result.success ? [] : result.error!.issues.map((issue) => issue.path.join("."));
}

describe("createPageCampaignSchema (F7.7)", () => {
  it("acepta una campaña válida y por defecto no toma el inicio", () => {
    expect(createPageCampaignSchema.parse(valid).replaceHome).toBe(false);
  });

  it("rechaza una ventana invertida, vacía o de más de un año", () => {
    expect(paths(createPageCampaignSchema.safeParse({ ...valid, endsAt: valid.startsAt }))).toContain("endsAt");
    expect(paths(createPageCampaignSchema.safeParse({ ...valid, endsAt: "2026-10-01T00:00:00.000Z" }))).toContain("endsAt");
    expect(paths(createPageCampaignSchema.safeParse({ ...valid, endsAt: "2027-12-01T00:00:00.000Z" }))).toContain("endsAt");
  });

  it("rechaza un objetivo fuera del catálogo, una fecha sin zona y un UTM con espacios", () => {
    expect(paths(createPageCampaignSchema.safeParse({ ...valid, objective: "ganar" }))).toContain("objective");
    expect(paths(createPageCampaignSchema.safeParse({ ...valid, startsAt: "2026-11-01T03:00:00" }))).toContain("startsAt");
    expect(paths(createPageCampaignSchema.safeParse({ ...valid, utmCampaign: "cyber día" }))).toContain("utmCampaign");
  });

  it("normaliza el UTM a minúsculas", () => {
    expect(createPageCampaignSchema.parse({ ...valid, utmCampaign: "Cyber-2026" }).utmCampaign).toBe("cyber-2026");
  });
});

describe("updatePageCampaignSchema", () => {
  it("pide al menos un campo y revisa la ventana si llegan ambas fechas", () => {
    expect(updatePageCampaignSchema.safeParse({}).success).toBe(false);
    expect(updatePageCampaignSchema.safeParse({ name: "Otra" }).success).toBe(true);
    expect(paths(updatePageCampaignSchema.safeParse({ startsAt: valid.endsAt, endsAt: valid.startsAt }))).toContain("endsAt");
  });
});

describe("pageCampaignStatus", () => {
  const campaign = { startsAt: valid.startsAt, endsAt: valid.endsAt, cancelledAt: null };

  it("programada, activa y terminada según la hora; el fin es exclusivo", () => {
    expect(pageCampaignStatus(campaign, new Date("2026-10-31T00:00:00.000Z"))).toBe("scheduled");
    expect(pageCampaignStatus(campaign, new Date(valid.startsAt))).toBe("active");
    expect(pageCampaignStatus(campaign, new Date(valid.endsAt))).toBe("ended");
  });

  it("cancelada manda sobre las fechas", () => {
    expect(pageCampaignStatus({ ...campaign, cancelledAt: "2026-11-02T00:00:00.000Z" }, new Date("2026-11-02T12:00:00.000Z"))).toBe("cancelled");
  });
});

describe("URL y UTM", () => {
  it("sugiere un UTM limpio desde el nombre", () => {
    expect(suggestUtmCampaign("  Cyber Día 2026!! ")).toBe("cyber-dia-2026");
  });

  it("arma la URL con fuente, medio y campaña", () => {
    const url = new URL(pageCampaignUrl({ publicBaseUrl: "https://impulza.one/", siteSlug: "cafe", pageSlug: "cyber", utmCampaign: "cyber-dia", source: "qr" }));
    expect(url.pathname).toBe("/cafe/cyber");
    expect(Object.fromEntries(url.searchParams)).toEqual({ utm_source: "qr", utm_medium: "qr", utm_campaign: "cyber-dia" });
    expect(new URL(pageCampaignUrl({ publicBaseUrl: "https://x.cl", siteSlug: "a", pageSlug: "b", utmCampaign: "c1", source: "instagram" })).searchParams.get("utm_medium")).toBe("social");
  });
});
