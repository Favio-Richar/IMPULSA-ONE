import { describe, expect, it } from "vitest";
import { bookingCancelledEmail, bookingConfirmationEmail, bookingReminderEmail, formatBookingWhen, ownerBookingNoticeEmail } from "./messages.js";

const data = {
  siteName: "Barbería El Filo",
  serviceName: "Corte y barba",
  startsAt: "2026-09-29T13:00:00Z",
  timeZone: "America/Santiago",
  priceAmount: 18000,
  priceCurrency: "CLP",
  paymentUrl: "https://pago.ejemplo.cl/barba",
  manageUrl: "https://impulza.one/reserva/abc",
};

describe("correos de reservas (F5.4)", () => {
  it("la hora va en la zona del negocio", () => {
    // 13:00Z es 10:00 en Santiago (GMT-3 en septiembre después del cambio).
    expect(formatBookingWhen(data.startsAt, data.timeZone)).toBe("martes, 29 de septiembre, 10:00");
  });

  it("la confirmación trae el detalle, el pago del negocio y el enlace para gestionarla", () => {
    const email = bookingConfirmationEmail(data);
    expect(email.subject).toBe("Reserva confirmada en Barbería El Filo");
    expect(email.text).toContain("Corte y barba");
    expect(email.text).toContain("Martes, 29 de septiembre, 10:00");
    expect(email.text).toContain("Valor: $18.000");
    expect(email.text).toContain("https://pago.ejemplo.cl/barba");
    expect(email.text).toContain("https://impulza.one/reserva/abc");
  });

  it("sin URL pública configurada, el correo lo dice en vez de traer un enlace roto", () => {
    const email = bookingReminderEmail({ ...data, manageUrl: null, paymentUrl: null, priceAmount: null, priceCurrency: null });
    expect(email.text).toContain("Responde este correo");
    expect(email.text).not.toContain("http");
    expect(email.text).not.toContain("Valor");
  });

  it("un nombre con saltos de línea no rompe el asunto (sin encabezados inyectados)", () => {
    const email = ownerBookingNoticeEmail({
      kind: "created",
      siteName: "Mi sitio",
      serviceName: "Corte",
      startsAt: data.startsAt,
      timeZone: data.timeZone,
      customerName: "Ana\r\nBcc: todos@ejemplo.cl",
      customerEmail: "ana@ejemplo.cl",
      customerPhone: null,
      note: null,
      agendaUrl: null,
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.startsWith("Nueva reserva: Ana Bcc")).toBe(true);
  });

  it("la cancelación no invita a pagar ni a gestionar", () => {
    const email = bookingCancelledEmail(data);
    expect(email.text).not.toContain("pago.ejemplo.cl");
    expect(email.text).not.toContain("/reserva/");
  });
});
