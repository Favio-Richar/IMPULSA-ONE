import { describe, expect, it } from "vitest";
import { buildIcs } from "./ics.js";

describe("buildIcs (F5.2)", () => {
  const base = {
    uid: "reserva-1@impulza",
    title: "Corte y barba — Barbería El Filo",
    start: new Date("2030-01-07T13:00:00Z"),
    end: new Date("2030-01-07T13:45:00Z"),
    now: new Date("2030-01-01T00:00:00Z"),
  };

  it("arma un evento válido con horas en UTC y saltos CRLF", () => {
    const ics = buildIcs(base);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20300107T130000Z\r\n");
    expect(ics).toContain("DTEND:20300107T134500Z\r\n");
    expect(ics).toContain("DTSTAMP:20300101T000000Z\r\n");
    expect(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n")).toBe(true);
  });

  it("escapa el texto del negocio y del cliente (sin inyectar propiedades)", () => {
    const ics = buildIcs({ ...base, title: "Corte; barba, y más\nDTSTART:19990101T000000Z", description: "Trae\\ tu foto" });
    expect(ics).toContain("SUMMARY:Corte\\; barba\\, y más\\nDTSTART:19990101T000000Z");
    expect(ics.match(/^DTSTART:/gm)).toHaveLength(1);
    expect(ics).toContain("DESCRIPTION:Trae\\\\ tu foto");
  });

  it("pliega las líneas largas a 75 octetos", () => {
    const ics = buildIcs({ ...base, description: "á".repeat(100) });
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
