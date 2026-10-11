import { describe, expect, it } from "vitest";
import {
  ABUSE_REPORT_DETAILS_MAX,
  ABUSE_REPORT_OTHER_DETAILS_MIN,
  ABUSE_REPORT_REASONS,
  cleanPlainText,
  createAbuseReportSchema,
} from "./abuse-report.js";

describe("reporte de abuso — validación", () => {
  it("acepta cada motivo del catálogo cerrado y rechaza cualquier otro", () => {
    for (const reason of ABUSE_REPORT_REASONS.filter((item) => item !== "OTHER")) {
      expect(createAbuseReportSchema.safeParse({ reason }).success).toBe(true);
    }
    expect(createAbuseReportSchema.safeParse({ reason: "ODIO" }).success).toBe(false);
    expect(createAbuseReportSchema.safeParse({}).success).toBe(false);
  });

  it("«otro» exige una explicación mínima; los demás motivos no", () => {
    expect(createAbuseReportSchema.safeParse({ reason: "OTHER" }).success).toBe(false);
    expect(createAbuseReportSchema.safeParse({ reason: "OTHER", details: "corto" }).success).toBe(false);
    expect(createAbuseReportSchema.safeParse({ reason: "OTHER", details: "x".repeat(ABUSE_REPORT_OTHER_DETAILS_MIN) }).success).toBe(true);
  });

  it("acota el texto y no admite campos desconocidos", () => {
    expect(createAbuseReportSchema.safeParse({ reason: "SPAM", details: "a".repeat(ABUSE_REPORT_DETAILS_MAX) }).success).toBe(true);
    expect(createAbuseReportSchema.safeParse({ reason: "SPAM", details: "a".repeat(ABUSE_REPORT_DETAILS_MAX + 1) }).success).toBe(false);
    expect(createAbuseReportSchema.safeParse({ reason: "SPAM", siteId: "otro" }).success).toBe(false);
  });

  it("el correo es opcional, válido y se normaliza a minúsculas", () => {
    expect(createAbuseReportSchema.parse({ reason: "SPAM", email: " Persona@Correo.COM " }).email).toBe("persona@correo.com");
    expect(createAbuseReportSchema.safeParse({ reason: "SPAM", email: "no-es-correo" }).success).toBe(false);
  });

  it("quita caracteres de control y direccionales, y conserva saltos de línea y acentos", () => {
    const crlf = String.fromCharCode(13, 10);
    const dirty = ["Hola", String.fromCharCode(0), " mundo", String.fromCharCode(0x202e, 0x200b), crlf, "Segunda línea con ñ", String.fromCharCode(7)].join("");
    expect(cleanPlainText(dirty)).toBe("Hola mundo\nSegunda línea con ñ");
    expect(createAbuseReportSchema.parse({ reason: "FRAUD", details: dirty }).details).toBe("Hola mundo\nSegunda línea con ñ");
  });

  it("no interpreta HTML: lo guarda como texto", () => {
    const parsed = createAbuseReportSchema.parse({ reason: "SPAM", details: "<script>alert(1)</script>" });
    expect(parsed.details).toBe("<script>alert(1)</script>");
  });
});
