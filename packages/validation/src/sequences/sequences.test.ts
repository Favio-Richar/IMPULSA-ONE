import { describe, expect, it } from "vitest";
import { createEmailSequenceSchema, describeDelay, firstName, MAX_SEQUENCE_STEPS, personalize, sequenceEmail, updateEmailSequenceSchema } from "./index.js";

const step = { delayHours: 0, subject: "Bienvenida", bodyHtml: "<p>Hola {{nombre}}, gracias.</p>" };

describe("secuencias de correo (F7.5, ADR-020)", () => {
  it("valida disparador del catálogo (con la newsletter), pasos y topes", () => {
    expect(createEmailSequenceSchema.safeParse({ name: "Bienvenida", trigger: "newsletter_subscribed", steps: [step] }).success).toBe(true);
    expect(createEmailSequenceSchema.safeParse({ name: "X", trigger: "page_viewed", steps: [step] }).success).toBe(false);
    expect(createEmailSequenceSchema.safeParse({ name: "X", trigger: "contact_created", steps: [] }).success).toBe(false);
    expect(createEmailSequenceSchema.safeParse({ name: "X", trigger: "contact_created", steps: Array.from({ length: MAX_SEQUENCE_STEPS + 1 }, () => step) }).success).toBe(false);
    expect(createEmailSequenceSchema.safeParse({ name: "X", trigger: "contact_created", steps: [{ ...step, delayHours: 1.5 }] }).success).toBe(false);
    expect(createEmailSequenceSchema.safeParse({ name: "X", trigger: "contact_created", steps: [{ ...step, delayHours: 24 * 366 }] }).success).toBe(false);
    expect(createEmailSequenceSchema.safeParse({ name: "X", trigger: "contact_created", steps: [{ ...step, bodyHtml: "<p> </p>" }] }).success).toBe(false);
    expect(updateEmailSequenceSchema.safeParse({}).success).toBe(false);
  });

  it("{{nombre}} se reemplaza escapado en HTML; sin nombre desaparece sin dejar la coma suelta", () => {
    expect(personalize("<p>Hola {{nombre}}, gracias.</p>", "Ana María", "html")).toBe("<p>Hola Ana, gracias.</p>");
    expect(personalize("<p>Hola {{ Nombre }}!</p>", "<script>x</script>", "html")).toBe("<p>Hola &lt;script&gt;x&lt;/script&gt;!</p>");
    expect(personalize("Hola {{nombre}}, gracias.", null, "text")).toBe("Hola, gracias.");
    // Al inicio, sin nombre, tampoco queda una coma colgando ("{{nombre}}, tu reserva" → "Tu reserva").
    expect(personalize("{{nombre}}, tu reserva está lista", "", "text")).toBe("Tu reserva está lista");
    expect(personalize("<p>{{nombre}}, tu reserva</p>", null, "html")).toBe("<p>Tu reserva</p>");
    expect(firstName("  Ana   María ")).toBe("Ana");
  });

  it("el correo de un paso lleva la baja y el asunto personalizado, sin saltos", () => {
    const mail = sequenceEmail({ organizationName: "Café Aroma", subject: "{{nombre}}, bienvenida", bodyHtml: step.bodyHtml, name: "Ana", unsubscribeUrl: "https://x.cl/baja/abc" });
    expect(mail.subject).toBe("Ana, bienvenida");
    expect(mail.html).toContain("Hola Ana, gracias.");
    expect(mail.html).toContain('href="https://x.cl/baja/abc"');
    expect(mail.text).toContain("https://x.cl/baja/abc");
    expect(sequenceEmail({ organizationName: "C", subject: "S", bodyHtml: "<p>x</p>", name: null, unsubscribeUrl: null, test: true }).subject).toBe("[Prueba] S");
  });

  it("describe las esperas como se leen", () => {
    expect(describeDelay(0)).toBe("al instante");
    expect(describeDelay(1)).toBe("1 hora");
    expect(describeDelay(48)).toBe("2 días");
    expect(describeDelay(28)).toBe("1 día y 4 horas");
  });
});
