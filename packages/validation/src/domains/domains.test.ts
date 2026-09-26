import { describe, expect, it } from "vitest";
import { createSiteDomainSchema, domainVerificationRecord, isPublicHostname, isSameOrSubdomain, normalizeDomainInput } from "./index.js";

describe("dominios propios (F4.7)", () => {
  it("normaliza lo que pega una persona: mayúsculas, https://, rutas y punto final", () => {
    expect(normalizeDomainInput("  HTTPS://www.Mi-Negocio.cl/contacto?x=1 ")).toBe("www.mi-negocio.cl");
    expect(normalizeDomainInput("mi-negocio.cl.")).toBe("mi-negocio.cl");
    // Con acentos pasa a punycode, como en el navegador.
    expect(normalizeDomainInput("peluquería.cl")).toBe("xn--peluquera-n5a.cl");
  });

  it("acepta dominios públicos, con y sin www, y subdominios", () => {
    for (const domain of ["mi-negocio.cl", "www.mi-negocio.cl", "tienda.mi-negocio.com.ar", "xn--peluquera-n5a.cl"]) {
      expect(createSiteDomainSchema.safeParse({ domain }).success, domain).toBe(true);
    }
  });

  it("rechaza IPs, puertos, credenciales, nombres internos y formatos inválidos (SSRF)", () => {
    for (const domain of [
      "127.0.0.1",
      "10.0.0.5",
      "[::1]",
      "localhost",
      "api.localhost",
      "impresora.local",
      "servidor.internal",
      "router.home.arpa",
      "mi-sitio.test",
      "ejemplo.example",
      "sinpunto",
      "-malo.cl",
      "malo-.cl",
      "mi_negocio.cl",
      "mi-negocio.cl:8080",
      "usuario@mi-negocio.cl",
      "mi negocio.cl",
      "a".repeat(64) + ".cl",
      "",
    ]) {
      expect(createSiteDomainSchema.safeParse({ domain }).success, domain).toBe(false);
    }
  });

  it("la verificación es un TXT en _impulza.<dominio> con el token", () => {
    expect(domainVerificationRecord("mi-negocio.cl", "abc123")).toEqual({
      name: "_impulza.mi-negocio.cl",
      value: "impulza-verificacion=abc123",
    });
  });

  it("detecta la plataforma y sus subdominios", () => {
    expect(isSameOrSubdomain("impulza.one", "impulza.one")).toBe(true);
    expect(isSameOrSubdomain("sitios.impulza.one", "impulza.one")).toBe(true);
    expect(isSameOrSubdomain("noimpulza.one", "impulza.one")).toBe(false);
    expect(isPublicHostname("impulza.one")).toBe(true);
  });
});
