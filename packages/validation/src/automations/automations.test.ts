import { describe, expect, it } from "vitest";
import { automationEventKey, automationJobId, automationNoticeEmail, createAutomationSchema, updateAutomationSchema } from "./index.js";

describe("automatizaciones (F6.7)", () => {
  it("solo disparadores y acciones del catálogo, con su configuración validada", () => {
    expect(createAutomationSchema.safeParse({ name: "Etiquetar", trigger: "booking_created", action: { type: "tag_contact", tag: "cliente-reserva" } }).success).toBe(true);
    expect(createAutomationSchema.safeParse({ name: "Estado", trigger: "order_created", action: { type: "set_commercial_status", status: "WON" } }).success).toBe(true);
    expect(createAutomationSchema.safeParse({ name: "Aviso", trigger: "contact_created", action: { type: "notify_team" } }).success).toBe(true);
    expect(createAutomationSchema.safeParse({ name: "X", trigger: "page_viewed", action: { type: "notify_team" } }).success).toBe(false);
    expect(createAutomationSchema.safeParse({ name: "X", trigger: "contact_created", action: { type: "webhook", url: "https://x" } }).success).toBe(false);
    expect(createAutomationSchema.safeParse({ name: "X", trigger: "contact_created", action: { type: "set_commercial_status", status: "VIP" } }).success).toBe(false);
    expect(createAutomationSchema.safeParse({ name: "X", trigger: "contact_created", action: { type: "tag_contact", tag: "a".repeat(41) } }).success).toBe(false);
    expect(updateAutomationSchema.safeParse({}).success).toBe(false);
    expect(updateAutomationSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("la clave de idempotencia identifica el evento, no la automatización", () => {
    expect(automationEventKey("booking_created", "b1")).toBe("booking_created:b1");
    // BullMQ rechaza ids propios con ":"; el id del trabajo no puede llevarlos.
    expect(automationJobId("booking_created", "b1")).toBe("automation-booking_created-b1");
    expect(automationJobId("booking_created", "b1")).not.toContain(":");
  });

  it("el aviso es texto plano, sin saltos en el asunto, y dice cómo apagarlo", () => {
    const email = automationNoticeEmail({
      organizationName: "Barbería\nFalsa: cabecera",
      automationName: "Avisar reservas",
      trigger: "booking_created",
      contact: { name: "Ana <b>Pérez</b>", email: "ana@example.com", phone: null },
      detail: "Corte · martes 29 de septiembre, 10:00",
      dashboardUrl: "https://panel.example.com/contactos/1",
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject).toContain("Nueva reserva: Ana <b>Pérez</b>");
    expect(email.text).toContain("Correo: ana@example.com");
    expect(email.text).not.toContain("Teléfono:");
    expect(email.text).toContain("Automatizaciones");
    expect(email.text).toContain("https://panel.example.com/contactos/1");
  });
});
