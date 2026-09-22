import { describe, expect, it } from "vitest";
import {
  buildFormSubmissionSchema,
  createFormFieldSchema,
  extractContactSignals,
  HONEYPOT_FIELD_KEY,
  type SubmittableFormField,
} from "./index.js";

const NAME_FIELD: SubmittableFormField = {
  id: "f-name",
  type: "TEXT",
  label: "Nombre",
  required: true,
  options: null,
};
const EMAIL_FIELD: SubmittableFormField = {
  id: "f-email",
  type: "EMAIL",
  label: "Correo",
  required: true,
  options: null,
};
const CONSENT_FIELD: SubmittableFormField = {
  id: "f-consent",
  type: "CONSENT",
  label: "Acepto ser contactado",
  required: false,
  options: null,
};

describe("createFormFieldSchema (F3.2)", () => {
  it("un campo SELECT sin opciones es rechazado", () => {
    const result = createFormFieldSchema.safeParse({ type: "SELECT", label: "Servicio" });
    expect(result.success).toBe(false);
  });

  it("un campo SELECT con opciones es válido", () => {
    const result = createFormFieldSchema.safeParse({
      type: "SELECT",
      label: "Servicio",
      options: ["Corte", "Color"],
    });
    expect(result.success).toBe(true);
  });
});

describe("buildFormSubmissionSchema (F3.2)", () => {
  const schema = buildFormSubmissionSchema([NAME_FIELD, EMAIL_FIELD, CONSENT_FIELD]);

  it("acepta un envío válido con el honeypot vacío", () => {
    const result = schema.safeParse({
      "f-name": "Ana",
      "f-email": "ana@ejemplo.cl",
      "f-consent": true,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza si falta un campo requerido", () => {
    const result = schema.safeParse({ "f-email": "ana@ejemplo.cl" });
    expect(result.success).toBe(false);
  });

  it("rechaza un correo con formato inválido", () => {
    const result = schema.safeParse({ "f-name": "Ana", "f-email": "no-es-correo" });
    expect(result.success).toBe(false);
  });

  it("rechaza claves que no correspondan a ningún campo declarado (`.strict()`)", () => {
    const result = schema.safeParse({
      "f-name": "Ana",
      "f-email": "ana@ejemplo.cl",
      campo_inventado: "x",
    });
    expect(result.success).toBe(false);
  });

  it("acepta el honeypot presente pero vacío (humano real)", () => {
    const result = schema.safeParse({
      "f-name": "Ana",
      "f-email": "ana@ejemplo.cl",
      [HONEYPOT_FIELD_KEY]: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("extractContactSignals (F3.2 / ADR-004)", () => {
  it("toma el primer campo TEXT como nombre y el primer EMAIL como correo", () => {
    const signals = extractContactSignals([NAME_FIELD, EMAIL_FIELD, CONSENT_FIELD], {
      "f-name": "Ana",
      "f-email": "ana@ejemplo.cl",
      "f-consent": true,
    });
    expect(signals).toEqual({
      name: "Ana",
      email: "ana@ejemplo.cl",
      phone: undefined,
      hasConsentField: true,
      consentGranted: true,
    });
  });

  it("sin campo CONSENT, hasConsentField es false y consentGranted también, aunque haya email", () => {
    const signals = extractContactSignals([NAME_FIELD, EMAIL_FIELD], {
      "f-name": "Ana",
      "f-email": "ana@ejemplo.cl",
    });
    expect(signals.hasConsentField).toBe(false);
    expect(signals.consentGranted).toBe(false);
  });

  it("con campo CONSENT presente pero sin marcar, consentGranted es false", () => {
    const signals = extractContactSignals([NAME_FIELD, EMAIL_FIELD, CONSENT_FIELD], {
      "f-name": "Ana",
      "f-email": "ana@ejemplo.cl",
      "f-consent": false,
    });
    expect(signals.hasConsentField).toBe(true);
    expect(signals.consentGranted).toBe(false);
  });
});
