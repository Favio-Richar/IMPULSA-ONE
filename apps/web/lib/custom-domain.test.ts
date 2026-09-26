import { describe, expect, it } from "vitest";
import { DomainCache, hostnameOf, internalPathFor, isPlatformHost } from "./custom-domain";

describe("dominios propios en apps/web (F4.7)", () => {
  it("toma el host sin puerto y en minúsculas", () => {
    expect(hostnameOf("Mi-Negocio.CL:443")).toBe("mi-negocio.cl");
    expect(hostnameOf("localhost:3300")).toBe("localhost");
    expect(hostnameOf("[::1]:3300")).toBe("[::1]");
    expect(hostnameOf(null)).toBe("");
  });

  it("la plataforma y los hosts locales se sirven tal cual", () => {
    expect(isPlatformHost("impulza.one", "https://impulza.one")).toBe(true);
    expect(isPlatformHost("localhost", "https://impulza.one")).toBe(true);
    expect(isPlatformHost("127.0.0.1", "https://impulza.one")).toBe(true);
    expect(isPlatformHost("mi-negocio.cl", "https://impulza.one")).toBe(false);
    expect(isPlatformHost("www.impulza.one", "https://impulza.one")).toBe(false);
  });

  it("traduce la ruta del dominio propio a la del sitio, sin salir nunca de él", () => {
    expect(internalPathFor("cafe-aroma", "/")).toBe("/cafe-aroma");
    expect(internalPathFor("cafe-aroma", "/carta")).toBe("/cafe-aroma/carta");
    expect(internalPathFor("cafe-aroma", "/robots.txt")).toBe("/cafe-aroma/robots.txt");
    // Los enlaces que la página arma con el slug siguen funcionando.
    expect(internalPathFor("cafe-aroma", "/cafe-aroma")).toBe("/cafe-aroma");
    expect(internalPathFor("cafe-aroma", "/cafe-aroma/carta")).toBe("/cafe-aroma/carta");
    // Otro slug se trata como una página de ESTE sitio, nunca como otro sitio.
    expect(internalPathFor("cafe-aroma", "/otro-sitio")).toBe("/cafe-aroma/otro-sitio");
    expect(internalPathFor("cafe-aroma", "/cafe-aroma-falso")).toBe("/cafe-aroma/cafe-aroma-falso");
  });

  it("la caché vence, recuerda también lo no encontrado por menos tiempo y no crece sin límite", () => {
    const cache = new DomainCache(1000, 100, 2);
    cache.set("a.cl", "a", 0);
    cache.set("b.cl", null, 0);
    expect(cache.get("a.cl", 500)).toEqual({ slug: "a" });
    expect(cache.get("b.cl", 50)).toEqual({ slug: null });
    expect(cache.get("b.cl", 150)).toBeUndefined();
    cache.set("c.cl", "c", 0);
    cache.set("d.cl", "d", 0);
    expect(cache.get("a.cl", 10)).toBeUndefined();
    expect(cache.get("d.cl", 10)).toEqual({ slug: "d" });
    expect(cache.get("a.cl", 0)).toBeUndefined();
  });
});
