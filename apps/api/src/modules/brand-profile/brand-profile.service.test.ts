import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@impulza/database";
import { DEFAULT_PLATFORM_BRANDING } from "@impulza/validation";
import { BrandProfileService } from "./brand-profile.service.js";
import type { PlatformBrandingService } from "../platform-branding/platform-branding.service.js";
import type { AuditService } from "../audit/audit.service.js";

// F9.2 Criterio 5: Prueba unitaria completa de la cascada de marca (resolveBrand)
// según las reglas de ADR-028 §4:
// Marca de la organización → Marca de la plataforma → Valores por defecto oficiales.
// Prueba exhaustiva de todas las combinaciones de campos presentes / ausentes.

describe("BrandProfileService — Cascada de marca (resolveBrand ADR-028 §4)", () => {
  let service: BrandProfileService;
  let prismaMock: { brandProfile: { findUnique: ReturnType<typeof vi.fn> } };
  let platformBrandingServiceMock: { getPublic: ReturnType<typeof vi.fn> };
  let auditServiceMock: { record: ReturnType<typeof vi.fn> };

  const ORG_ID = "00000000-0000-4000-a000-000000000001";

  beforeEach(() => {
    prismaMock = {
      brandProfile: {
        findUnique: vi.fn(),
      },
    };

    platformBrandingServiceMock = {
      getPublic: vi.fn().mockResolvedValue({
        name: "Plataforma Custom",
        logoLightUrl: "https://cdn.plataforma.app/logo-light.png",
        logoDarkUrl: "https://cdn.plataforma.app/logo-dark.png",
        faviconUrl: "https://cdn.plataforma.app/favicon.ico",
        primaryColor: "#1e3a8a",
        secondaryColor: "#1e40af",
        supportUrl: "https://ayuda.plataforma.app",
        privacyUrl: "/privacidad",
        termsUrl: "/terminos",
        footerText: "Plataforma global",
      }),
    };

    auditServiceMock = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    service = new BrandProfileService(
      prismaMock as unknown as PrismaClient,
      null,
      auditServiceMock as unknown as AuditService,
      platformBrandingServiceMock as unknown as PlatformBrandingService,
    );
  });

  it("Combinación 1: Organización tiene perfil completo → todos los campos provienen de la organización", async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValueOnce({
      id: "profile-1",
      organizationId: ORG_ID,
      displayName: "Café Aroma Gourmet",
      logoLightUrl: "https://cdn.cafearoma.cl/logo-l.png",
      logoDarkUrl: "https://cdn.cafearoma.cl/logo-d.png",
      faviconUrl: "https://cdn.cafearoma.cl/fav.ico",
      primaryColor: "#8b5a2b",
      secondaryColor: "#5c3a1e",
      contactEmail: "contacto@cafearoma.cl",
      contactPhone: "+56911223344",
      legalName: "Cafetería y Tostaduría Aroma SpA",
      taxId: "76.999.888-7",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const resolved = await service.resolveBrand(ORG_ID);

    expect(resolved.displayName).toBe("Café Aroma Gourmet");
    expect(resolved.logoLightUrl).toBe("https://cdn.cafearoma.cl/logo-l.png");
    expect(resolved.logoDarkUrl).toBe("https://cdn.cafearoma.cl/logo-d.png");
    expect(resolved.faviconUrl).toBe("https://cdn.cafearoma.cl/fav.ico");
    expect(resolved.primaryColor).toBe("#8b5a2b");
    expect(resolved.secondaryColor).toBe("#5c3a1e");
    expect(resolved.contactEmail).toBe("contacto@cafearoma.cl");
    expect(resolved.senderName).toBe("Plataforma Custom");
  });

  it("Combinación 2: Organización tiene perfil parcial (solo displayName y color) → logos y colores secundarios caen a plataforma", async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValueOnce({
      id: "profile-2",
      organizationId: ORG_ID,
      displayName: "Taller Mecánico Rápido",
      logoLightUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
      primaryColor: "#b91c1c",
      secondaryColor: null,
      contactEmail: null,
      contactPhone: null,
      legalName: null,
      taxId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const resolved = await service.resolveBrand(ORG_ID);

    expect(resolved.displayName).toBe("Taller Mecánico Rápido"); // De la org
    expect(resolved.primaryColor).toBe("#b91c1c"); // De la org
    expect(resolved.secondaryColor).toBe("#1e40af"); // Cae a plataforma
    expect(resolved.logoLightUrl).toBe("https://cdn.plataforma.app/logo-light.png"); // Cae a plataforma
    expect(resolved.logoDarkUrl).toBe("https://cdn.plataforma.app/logo-dark.png"); // Cae a plataforma
    expect(resolved.faviconUrl).toBe("https://cdn.plataforma.app/favicon.ico"); // Cae a plataforma
    expect(resolved.contactEmail).toBeNull();
  });

  it("Combinación 3: Organización no tiene displayName configurado → cae al nombre de la plataforma", async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValueOnce({
      id: "profile-3",
      organizationId: ORG_ID,
      displayName: null,
      logoLightUrl: "https://cdn.ejemplo.com/logo.png",
      logoDarkUrl: null,
      faviconUrl: null,
      primaryColor: null,
      secondaryColor: null,
      contactEmail: "hola@ejemplo.com",
      contactPhone: null,
      legalName: null,
      taxId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const resolved = await service.resolveBrand(ORG_ID);

    expect(resolved.displayName).toBe("Plataforma Custom"); // Cae a plataforma
    expect(resolved.logoLightUrl).toBe("https://cdn.ejemplo.com/logo.png"); // De la org
    expect(resolved.primaryColor).toBe("#1e3a8a"); // Cae a plataforma
    expect(resolved.contactEmail).toBe("hola@ejemplo.com"); // De la org
  });

  it("Combinación 4: Organización no tiene fila BrandProfile en BD → 100% de los campos caen a la plataforma", async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValueOnce(null);

    const resolved = await service.resolveBrand(ORG_ID);

    expect(resolved.displayName).toBe("Plataforma Custom");
    expect(resolved.logoLightUrl).toBe("https://cdn.plataforma.app/logo-light.png");
    expect(resolved.logoDarkUrl).toBe("https://cdn.plataforma.app/logo-dark.png");
    expect(resolved.faviconUrl).toBe("https://cdn.plataforma.app/favicon.ico");
    expect(resolved.primaryColor).toBe("#1e3a8a");
    expect(resolved.secondaryColor).toBe("#1e40af");
    expect(resolved.contactEmail).toBeNull();
  });

  it("Combinación 5: La plataforma tiene los valores por defecto oficiales de Impulza One → resuelve defaults", async () => {
    prismaMock.brandProfile.findUnique.mockResolvedValueOnce(null);
    platformBrandingServiceMock.getPublic.mockResolvedValueOnce({
      name: DEFAULT_PLATFORM_BRANDING.name,
      logoLightUrl: DEFAULT_PLATFORM_BRANDING.logoLightUrl,
      logoDarkUrl: DEFAULT_PLATFORM_BRANDING.logoDarkUrl,
      faviconUrl: DEFAULT_PLATFORM_BRANDING.faviconUrl,
      primaryColor: DEFAULT_PLATFORM_BRANDING.primaryColor,
      secondaryColor: DEFAULT_PLATFORM_BRANDING.secondaryColor,
      supportUrl: DEFAULT_PLATFORM_BRANDING.supportUrl,
      privacyUrl: DEFAULT_PLATFORM_BRANDING.privacyUrl,
      termsUrl: DEFAULT_PLATFORM_BRANDING.termsUrl,
      footerText: DEFAULT_PLATFORM_BRANDING.footerText,
    });

    const resolved = await service.resolveBrand(ORG_ID);

    expect(resolved.displayName).toBe("Impulza One");
    expect(resolved.logoLightUrl).toBeNull();
    expect(resolved.primaryColor).toBe("#0f6f6b");
    expect(resolved.secondaryColor).toBe("#0b5450");
  });
});
