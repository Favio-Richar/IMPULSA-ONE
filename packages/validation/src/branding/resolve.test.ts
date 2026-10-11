import { describe, expect, it } from "vitest";
import {
  applyOrganizationBrandDefaults,
  cascadeBrand,
  DEFAULT_PLATFORM_BRAND_ROW,
  resolveOrganizationBrand,
  safeBrandColor,
  type OrganizationBrandRow,
  type PlatformBrandRow,
} from "../index.js";

// F9.2 (ADR-028 §4): la cascada vive en UN solo lugar y la usan la API y el worker.

const PLATFORM: PlatformBrandRow = {
  name: "Plataforma",
  logoLightUrl: "https://cdn.plataforma.test/logo.png",
  logoDarkUrl: null,
  faviconUrl: "https://cdn.plataforma.test/fav.png",
  primaryColor: "#1e3a8a",
  secondaryColor: "#1e40af",
};

const FULL: OrganizationBrandRow = {
  displayName: "Mi Negocio",
  logoLightUrl: "https://media.test/branding/org/1/logo.png",
  logoDarkUrl: "https://media.test/branding/org/1/dark.png",
  faviconUrl: "https://media.test/branding/org/1/fav.png",
  primaryColor: "#0f6f6b",
  secondaryColor: "#0b5450",
  contactEmail: "hola@negocio.cl",
};

describe("cascadeBrand", () => {
  it("sin marca propia, todo viene de la plataforma", () => {
    expect(cascadeBrand(null, PLATFORM)).toEqual({
      displayName: "Plataforma",
      logoLightUrl: PLATFORM.logoLightUrl,
      logoDarkUrl: null,
      faviconUrl: PLATFORM.faviconUrl,
      primaryColor: "#1e3a8a",
      secondaryColor: "#1e40af",
      contactEmail: null,
      senderName: "Plataforma",
      senderEmail: null,
      whiteLabel: null,
    });
  });

  it("con marca completa, todo viene de la organización y firma con su nombre", () => {
    const brand = cascadeBrand(FULL, PLATFORM);
    expect(brand).toMatchObject({ displayName: "Mi Negocio", logoLightUrl: FULL.logoLightUrl, primaryColor: "#0f6f6b", senderName: "Mi Negocio", contactEmail: "hola@negocio.cl" });
    expect(brand.senderEmail).toBeNull(); // un remitente propio exige dominio verificado (F9.7)
  });

  it("con marca parcial, completa campo a campo desde la plataforma", () => {
    const brand = cascadeBrand({ ...FULL, logoLightUrl: null, secondaryColor: null }, PLATFORM);
    expect(brand.logoLightUrl).toBe(PLATFORM.logoLightUrl);
    expect(brand.secondaryColor).toBe("#1e40af");
    expect(brand.primaryColor).toBe("#0f6f6b");
  });

  it("siempre devuelve valores utilizables aunque la plataforma no tenga logo", () => {
    const brand = cascadeBrand(null, DEFAULT_PLATFORM_BRAND_ROW);
    expect(brand.displayName).toBeTruthy();
    expect(brand.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(brand.logoLightUrl).toBeNull();
  });
});

describe("resolveOrganizationBrand (nunca lanza)", () => {
  it("usa los cargadores y aplica la cascada", async () => {
    const brand = await resolveOrganizationBrand({ organization: async () => FULL, platform: async () => PLATFORM }, "org-1");
    expect(brand.displayName).toBe("Mi Negocio");
  });

  it("si no se puede leer la marca de la organización, cae a la de la plataforma", async () => {
    const brand = await resolveOrganizationBrand(
      { organization: async () => Promise.reject(new Error("base caída")), platform: async () => PLATFORM },
      "org-1",
    );
    expect(brand.displayName).toBe("Plataforma");
  });

  it("si tampoco se puede leer la de la plataforma, usa la de fábrica", async () => {
    const brand = await resolveOrganizationBrand(
      { organization: async () => Promise.reject(new Error("x")), platform: async () => Promise.reject(new Error("y")) },
      "org-1",
    );
    expect(brand.displayName).toBe(DEFAULT_PLATFORM_BRAND_ROW.name);
  });

  it("si la plataforma no tiene fila, usa la de fábrica", async () => {
    const brand = await resolveOrganizationBrand({ organization: async () => null, platform: async () => null }, "org-1");
    expect(brand.displayName).toBe(DEFAULT_PLATFORM_BRAND_ROW.name);
  });
});

describe("applyOrganizationBrandDefaults (valores por defecto de las páginas nuevas)", () => {
  const profile = (config: Record<string, unknown> = {}) => ({ type: "profile", config: { name: "Tu Negocio (ejemplo)", ...config } });
  const text = { type: "text", config: { html: "<p>x</p>" } };

  it("pone el nombre y el logo de la marca en el perfil", () => {
    const [result, other] = applyOrganizationBrandDefaults([profile(), text], FULL, undefined);
    const config = result!.config as { name: string; avatar: { url: string; alt: string } };
    expect(config.name).toBe("Mi Negocio");
    expect(config.avatar.url).toBe(FULL.logoLightUrl);
    expect(config.avatar.alt).toBe("Logo de Mi Negocio");
    expect(other).toEqual(text);
  });

  it("no pisa el nombre que la persona escribió", () => {
    const [result] = applyOrganizationBrandDefaults([profile({ name: "Nombre propio" })], FULL, "Nombre propio");
    expect((result!.config as { name: string }).name).toBe("Nombre propio");
  });

  it("no pisa un avatar existente ni se aplica a una portada completa (hero)", () => {
    const avatar = { url: "https://media.test/otra.png", alt: "otra" };
    const [withAvatar] = applyOrganizationBrandDefaults([profile({ avatar })], FULL, undefined);
    expect((withAvatar!.config as Record<string, unknown>).avatar).toEqual(avatar);
    const [hero] = applyOrganizationBrandDefaults([profile({ layout: "hero" })], FULL, undefined);
    expect((hero!.config as Record<string, unknown>).avatar).toBeUndefined();
  });

  it("sin marca propia no cambia nada (nunca se usa el logo de la plataforma)", () => {
    const blocks = [profile()];
    expect(applyOrganizationBrandDefaults(blocks, null, undefined)).toEqual(blocks);
  });

  it("descarta un logo que no es una URL segura", () => {
    const [result] = applyOrganizationBrandDefaults([profile()], { ...FULL, logoLightUrl: "javascript:alert(1)" }, undefined);
    expect((result!.config as Record<string, unknown>).avatar).toBeUndefined();
  });
});

describe("safeBrandColor", () => {
  it("deja pasar un hexadecimal y descarta cualquier otra cosa", () => {
    expect(safeBrandColor("#0f6f6b", "#000000")).toBe("#0f6f6b");
    expect(safeBrandColor("red;}body{display:none", "#000000")).toBe("#000000");
  });
});
