import { describe, expect, it } from "vitest";
import { newsletterBlockSchema } from "../blocks/catalog.js";
import {
  NEWSLETTER_CONFIRMATION_TTL_HOURS,
  newsletterAlreadySubscribedEmail,
  newsletterConfirmationEmail,
  newsletterConsentSource,
  newsletterSignupSchema,
} from "./index.js";

describe("newsletter con doble confirmación (F7.4, ADR-019)", () => {
  it("normaliza el correo y exige la casilla marcada de verdad (no basta con un texto «true»)", () => {
    expect(newsletterSignupSchema.parse({ email: "  Ana@Ejemplo.CL ", consent: true })).toEqual({ email: "ana@ejemplo.cl", consent: true });
    for (const consent of [false, "true", 1, undefined]) {
      const result = newsletterSignupSchema.safeParse({ email: "ana@ejemplo.cl", consent });
      expect(result.success, String(consent)).toBe(false);
    }
    const bad = newsletterSignupSchema.safeParse({ email: "no-es-correo", consent: true });
    expect(bad.error?.issues[0]?.message).toContain("correo válido");
  });

  it("el correo de confirmación lleva el enlace, el plazo y qué hacer si no fue uno; sin saltos en el asunto", () => {
    const mail = newsletterConfirmationEmail({ siteName: "Café\nAroma", confirmUrl: "https://impulza.cl/suscripcion/abc", name: "Ana" });
    expect(mail.subject).toBe("Confirma tu suscripción a Café Aroma");
    expect(mail.text).toContain("https://impulza.cl/suscripcion/abc");
    expect(mail.text).toContain(`${NEWSLETTER_CONFIRMATION_TTL_HOURS} horas`);
    expect(mail.text).toContain("Si no fuiste tú");
    expect(mail.text.startsWith("Hola, Ana:")).toBe(true);
  });

  it("el aviso a quien ya está suscrito no trae enlaces", () => {
    const mail = newsletterAlreadySubscribedEmail({ siteName: "Café Aroma" });
    expect(mail.text).not.toMatch(/https?:\/\//);
    expect(mail.subject).toBe("Ya estás suscrito a Café Aroma");
  });

  it("fuente del consentimiento y bloque con valores por defecto", () => {
    expect(newsletterConsentSource("s1")).toBe("newsletter:s1:double_opt_in");
    expect(newsletterBlockSchema.parse({})).toEqual({ askName: false, buttonLabel: "Suscribirme" });
  });
});
