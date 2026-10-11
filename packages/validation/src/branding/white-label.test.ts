import { describe, expect, it } from "vitest";
import { cascadeBrand, DEFAULT_PLATFORM_BRAND_ROW, resolveOrganizationBrand, type OrganizationBrandRow, type WhiteLabelBrandRow } from "./resolve.js";
import { brandNameKey, setClientWhiteLabelSchema, updateWhiteLabelSchema, whiteLabelFooter } from "./white-label.js";

const EMPTY: OrganizationBrandRow = { displayName: null, logoLightUrl: null, logoDarkUrl: null, faviconUrl: null, primaryColor: null, secondaryColor: null, contactEmail: null };
const business: OrganizationBrandRow = { ...EMPTY, displayName: "Café Aroma", primaryColor: "#7a3b00" };
const agency: WhiteLabelBrandRow = {
  ...EMPTY,
  displayName: "Estudio Norte",
  logoLightUrl: "https://cdn.example.test/norte.png",
  primaryColor: "#0f6f6b",
  contactEmail: "hola@norte.test",
  footerText: "Hecho con Estudio Norte",
  agencyName: "Estudio Norte SpA",
  agencyOrganizationId: "11111111-1111-4111-8111-111111111111",
  senderEmail: null,
};

describe("cascada con marca blanca (F9.7a)", () => {
  it("sin marca blanca todo sigue como en F9.2", () => {
    const resolved = cascadeBrand(business, DEFAULT_PLATFORM_BRAND_ROW);
    expect(resolved.displayName).toBe("Café Aroma");
    expect(resolved.whiteLabel).toBeNull();
    expect(cascadeBrand(null, DEFAULT_PLATFORM_BRAND_ROW).displayName).toBe(DEFAULT_PLATFORM_BRAND_ROW.name);
  });

  it("para el equipo del cliente (panel): la marca blanca manda sobre la del negocio y sobre la de la plataforma", () => {
    const resolved = cascadeBrand(business, DEFAULT_PLATFORM_BRAND_ROW, agency, "team");
    expect(resolved.displayName).toBe("Estudio Norte");
    expect(resolved.primaryColor).toBe("#0f6f6b");
    expect(resolved.logoLightUrl).toBe("https://cdn.example.test/norte.png");
    expect(resolved.whiteLabel).toEqual({
      agencyOrganizationId: agency.agencyOrganizationId,
      agencyName: "Estudio Norte SpA",
      footerText: "Hecho con Estudio Norte",
      platformName: DEFAULT_PLATFORM_BRAND_ROW.name,
    });
  });

  it("para el público del negocio: la marca del negocio manda; la de la agencia solo completa lo que falta", () => {
    const resolved = cascadeBrand(business, DEFAULT_PLATFORM_BRAND_ROW, agency, "customer");
    expect(resolved.displayName).toBe("Café Aroma");
    expect(resolved.primaryColor).toBe("#7a3b00");
    // El negocio no tiene logo: hereda el de la agencia antes que el de la plataforma.
    expect(resolved.logoLightUrl).toBe("https://cdn.example.test/norte.png");
    expect(resolved.whiteLabel).not.toBeNull();
  });

  it("un negocio sin marca propia y con marca blanca se presenta con la de la agencia; sin ninguna, con la de la plataforma", () => {
    expect(cascadeBrand(null, DEFAULT_PLATFORM_BRAND_ROW, agency, "customer").displayName).toBe("Estudio Norte");
    expect(cascadeBrand(null, DEFAULT_PLATFORM_BRAND_ROW, null, "team").displayName).toBe(DEFAULT_PLATFORM_BRAND_ROW.name);
  });

  it("si la marca final no usa nada de la agencia, no se marca como marca blanca", () => {
    const own: OrganizationBrandRow = { displayName: "Propio", logoLightUrl: "https://x.test/l.png", logoDarkUrl: "https://x.test/d.png", faviconUrl: "https://x.test/f.png", primaryColor: "#111111", secondaryColor: "#222222", contactEmail: "a@x.test" };
    const resolved = cascadeBrand(own, DEFAULT_PLATFORM_BRAND_ROW, { ...agency, displayName: null, logoLightUrl: null, primaryColor: null }, "customer");
    expect(resolved.whiteLabel).toBeNull();
  });

  it("resolveOrganizationBrand pasa la audiencia y nunca lanza si falla la marca blanca", async () => {
    const loaders = {
      organization: async () => business,
      platform: async () => null,
      whiteLabel: async () => agency,
    };
    expect((await resolveOrganizationBrand(loaders, "o", "team")).displayName).toBe("Estudio Norte");
    expect((await resolveOrganizationBrand(loaders, "o", "customer")).displayName).toBe("Café Aroma");
    const broken = { ...loaders, whiteLabel: async () => { throw new Error("db caída"); } };
    expect((await resolveOrganizationBrand(broken, "o", "team")).displayName).toBe("Café Aroma");
  });
});

describe("updateWhiteLabelSchema", () => {
  it("acepta una marca completa y normaliza vacíos a null", () => {
    const parsed = updateWhiteLabelSchema.parse({ displayName: " Estudio Norte ", primaryColor: "#0f6f6b", footerText: "", supportEmail: "" });
    expect(parsed).toMatchObject({ displayName: "Estudio Norte", primaryColor: "#0f6f6b", footerText: null, supportEmail: null });
  });

  it("rechaza colores sin contraste AA, logos que no son https, nombres cortos y pies largos", () => {
    expect(updateWhiteLabelSchema.safeParse({ primaryColor: "#ffff99" }).success).toBe(false);
    expect(updateWhiteLabelSchema.safeParse({ logoLightUrl: "http://x.test/l.png" }).success).toBe(false);
    expect(updateWhiteLabelSchema.safeParse({ logoLightUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(updateWhiteLabelSchema.safeParse({ displayName: "A" }).success).toBe(false);
    expect(updateWhiteLabelSchema.safeParse({ footerText: "x".repeat(201) }).success).toBe(false);
    expect(updateWhiteLabelSchema.safeParse({ supportEmail: "no-es-correo" }).success).toBe(false);
  });
});

describe("nombres y pie", () => {
  it("brandNameKey iguala variantes de un mismo nombre", () => {
    expect(brandNameKey("Café  Aroma!")).toBe(brandNameKey("cafe aroma"));
    expect(brandNameKey("Impulza One")).toBe(brandNameKey("IMPULZA-one"));
    expect(brandNameKey("Impulza One")).not.toBe(brandNameKey("Impulza Uno"));
  });

  it("el pie se recorta y nunca inventa texto", () => {
    expect(whiteLabelFooter(null)).toBeNull();
    expect(whiteLabelFooter("   ")).toBeNull();
    expect(whiteLabelFooter(" Hola ")).toBe("Hola");
  });

  it("activar es un booleano estricto", () => {
    expect(setClientWhiteLabelSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(setClientWhiteLabelSchema.safeParse({ enabled: "yes" }).success).toBe(false);
  });
});

describe("remitente de la marca blanca (F9.7b)", () => {
  const verified = { ...agency, senderEmail: "hola@estudionorte.test" };

  it("sin dominio verificado, el remitente es el de la plataforma (el correo del cargador es null) y el nombre de la agencia queda visible", () => {
    const resolved = cascadeBrand(null, DEFAULT_PLATFORM_BRAND_ROW, agency, "team");
    expect(resolved.senderEmail).toBeNull();
    expect(resolved.senderName).toBe("Estudio Norte");
  });

  it("con dominio verificado, firma la agencia en lo que lleva SU nombre", () => {
    expect(cascadeBrand(null, DEFAULT_PLATFORM_BRAND_ROW, verified, "team").senderEmail).toBe("hola@estudionorte.test");
    expect(cascadeBrand(null, DEFAULT_PLATFORM_BRAND_ROW, verified, "customer").senderEmail).toBe("hola@estudionorte.test");
  });

  it("si el nombre que firma es el del negocio, el remitente de la agencia no se usa aunque esté verificado", () => {
    expect(cascadeBrand(business, DEFAULT_PLATFORM_BRAND_ROW, verified, "customer").senderEmail).toBeNull();
    // Hacia el equipo del cliente sí manda la agencia.
    expect(cascadeBrand(business, DEFAULT_PLATFORM_BRAND_ROW, verified, "team").senderEmail).toBe("hola@estudionorte.test");
  });
});

