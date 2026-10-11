import { describe, expect, it } from "vitest";
import { toCsv } from "../agency/import-csv.js";
import { AUDIT_EXPORT_MAX_ROWS, auditDateBounds, auditExportQuerySchema, auditMetadataText, auditQuerySchema } from "./index.js";

describe("auditQuerySchema", () => {
  it("usa valores por defecto y acota la página", () => {
    expect(auditQuerySchema.parse({})).toEqual({ limit: 25, offset: 0 });
    expect(auditQuerySchema.parse({ limit: "100", offset: "50" })).toMatchObject({ limit: 100, offset: 50 });
    expect(auditQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it("valida la acción, el tipo de recurso y el cliente", () => {
    expect(auditQuerySchema.safeParse({ action: "publish_request.approved" }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ action: "Publish%" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ action: "a b" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ targetType: "PublishRequest" }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ targetType: "Page; DROP" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ client: "no-es-uuid" }).success).toBe(false);
  });

  it("valida fechas: formato, existencia, orden y tope de rango", () => {
    expect(auditQuerySchema.safeParse({ from: "2026-10-01", to: "2026-10-10" }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ from: "01/10/2026" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: "2026-13-45" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: "2026-10-10", to: "2026-10-01" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: "2024-01-01", to: "2026-10-01" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
  });

  it("la exportación acepta los mismos filtros y no pagina", () => {
    expect(auditExportQuerySchema.parse({ action: "page." })).toEqual({ action: "page." });
    expect(auditExportQuerySchema.safeParse({ from: "2026-10-10", to: "2026-10-01" }).success).toBe(false);
    expect(AUDIT_EXPORT_MAX_ROWS).toBeGreaterThan(0);
  });
});

describe("auditDateBounds", () => {
  it("incluye el día completo de `to`", () => {
    const bounds = auditDateBounds({ from: "2026-10-01", to: "2026-10-01" });
    expect(bounds.gte?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(bounds.lt?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(auditDateBounds({})).toEqual({});
  });
});

describe("exportación CSV segura", () => {
  it("neutraliza fórmulas en lo que escribe un usuario (correo, nombre, detalle)", () => {
    const csv = toCsv([["Detalle"], ["=HYPERLINK(\"http://x\")"], ["+cmd|' /C calc'!A0"], ["@SUM(1)"], ["-2+3"]]);
    const body = csv.replace("﻿", "").split("\r\n");
    expect(body[1]).toMatch(/^"?'=/);
    expect(body[2]).toMatch(/^'\+/);
    expect(body[3]).toMatch(/^'@/);
    expect(body[4]).toMatch(/^'-/);
  });

  it("el detalle se recorta con una marca visible", () => {
    expect(auditMetadataText(null)).toBe("");
    expect(auditMetadataText({ a: 1 })).toBe('{"a":1}');
    const long = auditMetadataText({ text: "x".repeat(5000) });
    expect(long.length).toBe(1001);
    expect(long.endsWith("…")).toBe(true);
  });
});
