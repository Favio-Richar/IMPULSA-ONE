import { describe, expect, it } from "vitest";
import { CATEGORIAS_INTEGRACIONES, INTEGRACIONES } from "./integraciones";
import { FECHA_VIGENCIA_PRIVACIDAD, SECCIONES_PRIVACIDAD } from "./privacidad";
import { HERRAMIENTAS_UTILES, RECURSOS_GUIAS } from "./recursos";
import { SOLUCIONES_RUBROS } from "./soluciones";

describe("Sitio comercial - Catálogos y datos institucionales (F7.10, ADR-025)", () => {
  describe("Soluciones por rubro (SOLUCIONES_RUBROS)", () => {
    it("posee al menos 6 industrias comerciales con datos completos", () => {
      expect(SOLUCIONES_RUBROS.length).toBeGreaterThanOrEqual(6);

      const slugs = new Set<string>();
      for (const rubro of SOLUCIONES_RUBROS) {
        expect(rubro.id).toBeTruthy();
        expect(rubro.slug).toBeTruthy();
        expect(rubro.nombre).toBeTruthy();
        expect(rubro.tagline).toBeTruthy();
        expect(rubro.descripcion).toBeTruthy();
        expect(rubro.problemas.length).toBeGreaterThanOrEqual(2);
        expect(rubro.beneficios.length).toBeGreaterThanOrEqual(2);
        expect(rubro.bloquesRecomendados.length).toBeGreaterThanOrEqual(2);
        expect(rubro.plantillaRecomendada.nombre).toBeTruthy();

        expect(slugs.has(rubro.slug)).toBe(false);
        slugs.add(rubro.slug);
      }
    });

    it("incluye rubros esenciales para el mercado chileno", () => {
      const rubroSlugs = SOLUCIONES_RUBROS.map((r) => r.slug);
      expect(rubroSlugs).toContain("salud-bienestar");
      expect(rubroSlugs).toContain("gastronomia-local");
      expect(rubroSlugs).toContain("creadores-marca");
      expect(rubroSlugs).toContain("tiendas-comercio");
      expect(rubroSlugs).toContain("servicios-b2b");
      expect(rubroSlugs).toContain("educacion-talleres");
    });
  });

  describe("Directorio de integraciones (INTEGRACIONES)", () => {
    it("todas las integraciones pertenecen a una categoría válida", () => {
      const categoriasValidas = new Set(CATEGORIAS_INTEGRACIONES.map((c) => c.id));
      expect(categoriasValidas.size).toBeGreaterThan(0);

      const ids = new Set<string>();
      for (const integ of INTEGRACIONES) {
        expect(integ.id).toBeTruthy();
        expect(integ.nombre).toBeTruthy();
        expect(categoriasValidas.has(integ.categoria)).toBe(true);
        expect(integ.descripcion).toBeTruthy();
        expect(integ.beneficios.length).toBeGreaterThanOrEqual(2);
        expect(["Disponible", "Procesamiento nativo"]).toContain(integ.estado);

        expect(ids.has(integ.id)).toBe(false);
        ids.add(integ.id);
      }
    });

    it("incluye pasarelas de pago y calendarios reales implementados en Impulza One", () => {
      const ids = INTEGRACIONES.map((i) => i.id);
      expect(ids).toContain("webpay-oneclick");
      expect(ids).toContain("mercado-pago");
      expect(ids).toContain("google-calendar");
      expect(ids).toContain("ical-universal");
      expect(ids).toContain("webhooks-propios");
      expect(ids).toContain("whatsapp");
      expect(ids).toContain("google-analytics-4");
      expect(ids).toContain("meta-pixel");
    });
  });

  describe("Recursos y guías prácticas (RECURSOS_GUIAS, HERRAMIENTAS_UTILES)", () => {
    it("incluye guías con estructura y tiempos de lectura", () => {
      expect(RECURSOS_GUIAS.length).toBeGreaterThanOrEqual(4);
      const ids = new Set<string>();

      for (const guia of RECURSOS_GUIAS) {
        expect(guia.id).toBeTruthy();
        expect(guia.titulo).toBeTruthy();
        expect(guia.categoria).toBeTruthy();
        expect(guia.resumen).toBeTruthy();
        expect(guia.tiempoLectura).toMatch(/\d+ min/);
        expect(guia.puntosClave.length).toBeGreaterThanOrEqual(2);

        expect(ids.has(guia.id)).toBe(false);
        ids.add(guia.id);
      }
    });

    it("incluye herramientas con enlaces de destino válidos", () => {
      expect(HERRAMIENTAS_UTILES.length).toBeGreaterThanOrEqual(3);
      for (const herramienta of HERRAMIENTAS_UTILES) {
        expect(herramienta.titulo).toBeTruthy();
        expect(herramienta.descripcion).toBeTruthy();
        expect(herramienta.enlace.startsWith("/")).toBe(true);
      }
    });
  });

  describe("Política de Privacidad y cumplimiento normativo chileno (SECCIONES_PRIVACIDAD)", () => {
    it("cumple con la Ley 19.628 y Ley 21.719 con vigencia válida", () => {
      expect(FECHA_VIGENCIA_PRIVACIDAD).toBeTruthy();
      expect(SECCIONES_PRIVACIDAD.length).toBeGreaterThanOrEqual(8);

      const sectionIds = SECCIONES_PRIVACIDAD.map((s) => s.id);
      expect(sectionIds).toContain("responsable");
      expect(sectionIds).toContain("datos-recopilados");
      expect(sectionIds).toContain("finalidades");
      expect(sectionIds).toContain("encargado-tratamiento");
      expect(sectionIds).toContain("seguridad");
      expect(sectionIds).toContain("cookies-analitica");
      expect(sectionIds).toContain("retencion");
      expect(sectionIds).toContain("derechos-arco");
      expect(sectionIds).toContain("contacto-privacidad");
    });

    it("la sección de seguridad detalla los algoritmos de cifrado y aislamiento", () => {
      const seg = SECCIONES_PRIVACIDAD.find((s) => s.id === "seguridad");
      expect(seg).toBeDefined();
      const textoCompleto = [
        ...(seg?.parrafos ?? []),
        ...(seg?.destacados ?? []),
      ].join(" ");

      expect(textoCompleto).toContain("AES-256-GCM");
      expect(textoCompleto).toContain("Argon2id");
      expect(textoCompleto).toContain("multi-tenant");
      expect(textoCompleto).toContain("HMAC");
    });

    it("la sección de encargado aclara que los datos de contactos pertenecen al negocio", () => {
      const encargado = SECCIONES_PRIVACIDAD.find((s) => s.id === "encargado-tratamiento");
      expect(encargado).toBeDefined();
      const textoCompleto = (encargado?.parrafos ?? []).join(" ");
      expect(textoCompleto).toContain("Encargado del tratamiento");
      expect(textoCompleto).toContain("te pertenecen exclusivamente");
    });
  });
});
