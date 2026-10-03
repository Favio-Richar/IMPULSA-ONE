import { describe, expect, it } from "vitest";
import { AGENCY_CLIENT_STATUSES, AGENCY_TRANSFER_TTL_DAYS, canStartTransfer, createTransferSchema, isTransferExpired, missingConsents, requiredConsents, transferExpiry } from "../index.js";

describe("traspaso de un cliente — reglas", () => {
  it("solo se puede iniciar desde ACTIVE", () => {
    for (const status of AGENCY_CLIENT_STATUSES) expect(canStartTransfer(status)).toBe(status === "ACTIVE");
  });

  it("el propietario siempre consiente; la agencia receptora también si el destino es otra agencia", () => {
    expect(requiredConsents("OWNER")).toEqual(["OWNER"]);
    expect(requiredConsents("AGENCY")).toEqual(["OWNER", "RECEIVER"]);
  });

  it("calcula lo que falta para completar", () => {
    const now = new Date();
    expect(missingConsents({ toKind: "OWNER", ownerAcceptedAt: null, receiverAcceptedAt: null })).toEqual(["OWNER"]);
    expect(missingConsents({ toKind: "OWNER", ownerAcceptedAt: now, receiverAcceptedAt: null })).toEqual([]);
    expect(missingConsents({ toKind: "AGENCY", ownerAcceptedAt: null, receiverAcceptedAt: null })).toEqual(["OWNER", "RECEIVER"]);
    expect(missingConsents({ toKind: "AGENCY", ownerAcceptedAt: now, receiverAcceptedAt: null })).toEqual(["RECEIVER"]);
    expect(missingConsents({ toKind: "AGENCY", ownerAcceptedAt: null, receiverAcceptedAt: now })).toEqual(["OWNER"]);
    expect(missingConsents({ toKind: "AGENCY", ownerAcceptedAt: now, receiverAcceptedAt: now })).toEqual([]);
  });

  it("el vencimiento es a los 14 días y se evalúa sin ambigüedad en el límite", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    const expires = transferExpiry(now);
    expect(expires.toISOString()).toBe("2026-10-17T12:00:00.000Z");
    expect(AGENCY_TRANSFER_TTL_DAYS).toBe(14);
    expect(isTransferExpired(expires, new Date(expires.getTime() - 1))).toBe(false);
    expect(isTransferExpired(expires, expires)).toBe(true);
    expect(isTransferExpired(expires, new Date(expires.getTime() + 1))).toBe(true);
  });

  it("el cuerpo: al propietario no lleva más datos; a otra agencia exige su identificador y el correo de su propietario", () => {
    expect(createTransferSchema.safeParse({ to: "OWNER" }).success).toBe(true);
    expect(createTransferSchema.safeParse({ to: "AGENCY", agencySlug: "otra-agencia", agencyOwnerEmail: "Dueno@Agencia.cl" })).toMatchObject({
      success: true,
      data: { agencyOwnerEmail: "dueno@agencia.cl" },
    });
    for (const bad of [{}, { to: "OTRO" }, { to: "AGENCY" }, { to: "AGENCY", agencySlug: "otra-agencia" }, { to: "AGENCY", agencyOwnerEmail: "a@b.cl" }, { to: "AGENCY", agencySlug: "NO VALIDO", agencyOwnerEmail: "a@b.cl" }, { to: "AGENCY", agencySlug: "otra-agencia", agencyOwnerEmail: "no-correo" }]) {
      expect(createTransferSchema.safeParse(bad).success).toBe(false);
    }
  });
});
