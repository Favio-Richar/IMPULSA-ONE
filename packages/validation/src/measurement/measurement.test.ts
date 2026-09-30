import { describe, expect, it } from "vitest";
import { CONSENT_MAX_AGE_MS, CONSENT_VERSION, consentStorageKey, measurementSettingsSchema, parseConsentChoice, providerCallsFor } from "./index.js";

describe("medición de terceros (F7.1, ADR-016)", () => {
  it("acepta solo identificadores, normaliza GA4 a mayúsculas y rechaza código o URLs", () => {
    expect(measurementSettingsSchema.parse({ ga4MeasurementId: " g-ab12cd34ef ", metaPixelId: "1234567890123456" })).toEqual({
      ga4MeasurementId: "G-AB12CD34EF",
      metaPixelId: "1234567890123456",
    });
    expect(measurementSettingsSchema.parse({ ga4MeasurementId: null, metaPixelId: null })).toEqual({ ga4MeasurementId: null, metaPixelId: null });
    for (const bad of ["UA-12345-1", "G-", "G-AB<script>", "<script>gtag()</script>", "https://www.googletagmanager.com/gtag/js?id=G-1234", "G-AB12CD34EF'; alert(1)//"]) {
      expect(measurementSettingsSchema.safeParse({ ga4MeasurementId: bad, metaPixelId: null }).success, bad).toBe(false);
    }
    for (const bad of ["123", "12345678901234567890123", "1234567890abc", "fbq('init','1234567890')"]) {
      expect(measurementSettingsSchema.safeParse({ ga4MeasurementId: null, metaPixelId: bad }).success, bad).toBe(false);
    }
  });

  it("la elección del visitante vale por sitio, versión y 6 meses; lo demás vuelve a preguntar", () => {
    const now = Date.UTC(2026, 8, 30);
    const choice = { version: CONSENT_VERSION, analytics: true, marketing: false, decidedAt: now - 1000 };
    expect(parseConsentChoice(JSON.stringify(choice), now)).toEqual(choice);
    expect(parseConsentChoice(null, now)).toBeNull();
    expect(parseConsentChoice("no-json", now)).toBeNull();
    expect(parseConsentChoice(JSON.stringify({ ...choice, version: CONSENT_VERSION + 1 }), now)).toBeNull();
    expect(parseConsentChoice(JSON.stringify({ ...choice, decidedAt: now - CONSENT_MAX_AGE_MS - 1 }), now)).toBeNull();
    expect(parseConsentChoice(JSON.stringify({ ...choice, decidedAt: now + 60_000 }), now)).toBeNull();
    expect(parseConsentChoice(JSON.stringify({ ...choice, analytics: "sí" }), now)).toBeNull();
    expect(consentStorageKey("mi-negocio")).not.toBe(consentStorageKey("otro-negocio"));
  });

  it("cada conversión va solo a los proveedores activos y con consentimiento, sin datos personales", () => {
    const both = { ga4: true, meta: true };
    expect(providerCallsFor({ kind: "form_submitted" }, { analytics: true, marketing: true }, both)).toEqual([
      { provider: "ga4", name: "generate_lead", params: { lead_source: "form" } },
      { provider: "meta", name: "Lead", params: {} },
    ]);
    expect(providerCallsFor({ kind: "booking_created" }, { analytics: false, marketing: true }, both)).toEqual([{ provider: "meta", name: "Schedule", params: {} }]);
    expect(providerCallsFor({ kind: "whatsapp_click" }, { analytics: true, marketing: false }, both)).toEqual([{ provider: "ga4", name: "whatsapp_click", params: {} }]);
    // Sin consentimiento, o con el proveedor apagado, nada.
    expect(providerCallsFor({ kind: "form_submitted" }, { analytics: false, marketing: false }, both)).toEqual([]);
    expect(providerCallsFor({ kind: "form_submitted" }, { analytics: true, marketing: true }, { ga4: false, meta: false })).toEqual([]);
  });

  it("el valor de un pedido va en la moneda (pesos sin decimales, dólares con centavos)", () => {
    const clp = providerCallsFor({ kind: "order_created", value: 25_980, currency: "CLP" }, { analytics: true, marketing: true }, { ga4: true, meta: true });
    expect(clp).toEqual([
      { provider: "ga4", name: "begin_checkout", params: { currency: "CLP", value: 25_980 } },
      { provider: "meta", name: "InitiateCheckout", params: { currency: "CLP", value: 25_980 } },
    ]);
    const usd = providerCallsFor({ kind: "order_created", value: 1_990, currency: "USD" }, { analytics: true, marketing: false }, { ga4: true, meta: true });
    expect(usd[0]!.params.value).toBe(19.9);
  });
});
