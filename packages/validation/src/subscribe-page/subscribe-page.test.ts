import { describe, expect, it } from "vitest";
import { memberHasAccess } from "../members/index.js";
import { freeSubscribeSchema, subscribePageSchema, subscribePath, SUBSCRIBE_BENEFITS_MAX } from "./index.js";

describe("página de suscripción", () => {
  it("acepta una página completa y limpia el texto", () => {
    const parsed = subscribePageSchema.parse({ enabled: true, title: "  Únete  ", description: "Hola\u0000 mundo", benefits: [" Clases "], freeEnabled: false, imageUrl: "https://cdn.ejemplo.cl/a.jpg" });
    expect(parsed.title).toBe("Únete");
    expect(parsed.benefits).toEqual(["Clases"]);
    expect(parsed.description).not.toContain("\u0000");
  });

  it("rechaza título corto, demasiados beneficios, campos desconocidos y direcciones inseguras", () => {
    const base = { enabled: true, title: "Únete", benefits: [], freeEnabled: true };
    expect(subscribePageSchema.safeParse({ ...base, title: "a" }).success).toBe(false);
    expect(subscribePageSchema.safeParse({ ...base, benefits: Array.from({ length: SUBSCRIBE_BENEFITS_MAX + 1 }, (_, i) => `b${i}`) }).success).toBe(false);
    expect(subscribePageSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(subscribePageSchema.safeParse({ ...base, imageUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("la suscripción gratuita normaliza el correo y no admite campos extra", () => {
    expect(freeSubscribeSchema.parse({ email: "  Fan@Correo.CL " }).email).toBe("fan@correo.cl");
    expect(freeSubscribeSchema.safeParse({ email: "fan@correo.cl", role: "admin" }).success).toBe(false);
    expect(freeSubscribeSchema.safeParse({ email: "no-es-correo" }).success).toBe(false);
  });

  it("un suscriptor gratuito tiene acceso mientras esté activo; uno de pago, solo con periodo vigente", () => {
    expect(memberHasAccess({ source: "FREE" }, [], new Date())).toBe(true);
    expect(memberHasAccess({ source: "INVITED" }, [], new Date())).toBe(true);
    expect(memberHasAccess({ source: "PURCHASED" }, [], new Date())).toBe(false);
  });

  it("la dirección usa una sola letra, que ninguna página puede tener", () => {
    expect(subscribePath("cafe")).toBe("/cafe/s");
  });
});
