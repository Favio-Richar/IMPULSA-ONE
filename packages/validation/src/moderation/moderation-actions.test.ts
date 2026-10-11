import { describe, expect, it } from "vitest";
import {
  ABUSE_REPORT_STATUSES,
  APPEAL_TEXT_MAX,
  APPEAL_TEXT_MIN,
  MODERATION_ACTIONS,
  availableModerationActions,
  canAppeal,
  createAppealSchema,
  effectiveStatus,
  listAbuseReportsQuerySchema,
  moderationActionSchema,
  moderationTransition,
} from "./moderation-actions.js";

describe("moderación — transiciones", () => {
  it("un caso cerrado (descartado) no admite ninguna acción", () => {
    expect(availableModerationActions("DISMISSED")).toEqual([]);
  });

  it("toda medida vigente se puede deshacer, y nada vuelve a «abierto» por esta vía", () => {
    for (const status of ["WARNED", "SITE_UNPUBLISHED", "ORG_SUSPENDED"] as const) {
      expect(moderationTransition(status, "restore")).toBe("DISMISSED");
    }
    for (const status of ABUSE_REPORT_STATUSES) {
      for (const before of [null, "OPEN", "WARNED", "SITE_UNPUBLISHED", "ORG_SUSPENDED"] as const) {
        for (const action of MODERATION_ACTIONS) {
          expect(moderationTransition(status, action, before)).not.toBe("OPEN");
        }
      }
    }
  });

  it("no se puede restaurar lo que no tiene medida ni suspender o despublicar dos veces", () => {
    expect(moderationTransition("OPEN", "restore")).toBeNull();
    expect(moderationTransition("ORG_SUSPENDED", "suspend")).toBeNull();
    expect(moderationTransition("SITE_UNPUBLISHED", "unpublish")).toBeNull();
  });

  it("`uphold` solo existe durante una apelación y devuelve el caso a la medida que tenía", () => {
    expect(moderationTransition("APPEALED", "uphold", "SITE_UNPUBLISHED")).toBe("SITE_UNPUBLISHED");
    expect(moderationTransition("APPEALED", "uphold", "ORG_SUSPENDED")).toBe("ORG_SUSPENDED");
    expect(moderationTransition("APPEALED", "uphold", null)).toBeNull();
    expect(moderationTransition("SITE_UNPUBLISHED", "uphold", null)).toBeNull();
    expect(moderationTransition("OPEN", "uphold")).toBeNull();
  });

  it("durante la apelación la medida sigue vigente: se decide sobre el estado de antes", () => {
    expect(effectiveStatus("APPEALED", "SITE_UNPUBLISHED")).toBe("SITE_UNPUBLISHED");
    expect(effectiveStatus("OPEN", "SITE_UNPUBLISHED")).toBe("OPEN");
    expect(availableModerationActions("APPEALED", "SITE_UNPUBLISHED")).toEqual(["suspend", "restore", "uphold"]);
    expect(availableModerationActions("APPEALED", "ORG_SUSPENDED")).toEqual(["restore", "uphold"]);
    expect(availableModerationActions("APPEALED", "WARNED")).toEqual(["dismiss", "unpublish", "suspend", "restore", "uphold"]);
    // Descartar no está disponible con una medida que deshacer: se restaura.
    expect(moderationTransition("APPEALED", "dismiss", "SITE_UNPUBLISHED")).toBeNull();
  });

  it("el propietario apela una sola vez y solo una medida vigente", () => {
    expect(canAppeal("WARNED", null)).toBe(true);
    expect(canAppeal("SITE_UNPUBLISHED", null)).toBe(true);
    expect(canAppeal("ORG_SUSPENDED", null)).toBe(true);
    expect(canAppeal("SITE_UNPUBLISHED", new Date())).toBe(false);
    expect(canAppeal("OPEN", null)).toBe(false);
    expect(canAppeal("DISMISSED", null)).toBe(false);
    expect(canAppeal("APPEALED", null)).toBe(false);
  });
});

describe("moderación — entradas", () => {
  it("el motivo es obligatorio, se recorta y está acotado", () => {
    expect(moderationActionSchema.safeParse({}).success).toBe(false);
    expect(moderationActionSchema.safeParse({ reason: "   ok  " }).success).toBe(false);
    expect(moderationActionSchema.parse({ reason: "  Contenido fraudulento verificado  " }).reason).toBe("Contenido fraudulento verificado");
    expect(moderationActionSchema.safeParse({ reason: "a".repeat(501) }).success).toBe(false);
    expect(moderationActionSchema.safeParse({ reason: "motivo válido", extra: 1 }).success).toBe(false);
  });

  it("la apelación exige una explicación, la sanea y está acotada", () => {
    expect(createAppealSchema.safeParse({}).success).toBe(false);
    expect(createAppealSchema.safeParse({ text: "no corresponde" }).success).toBe(false);
    expect(createAppealSchema.safeParse({ text: "a".repeat(APPEAL_TEXT_MIN) }).success).toBe(true);
    expect(createAppealSchema.safeParse({ text: "a".repeat(APPEAL_TEXT_MAX + 1) }).success).toBe(false);
    expect(createAppealSchema.safeParse({ text: "a".repeat(APPEAL_TEXT_MIN), casoId: "x" }).success).toBe(false);
    const dirty = `Es mi propio contenido${String.fromCharCode(0)}${String.fromCharCode(0x202e)}, no corresponde.`;
    expect(createAppealSchema.parse({ text: dirty }).text).toBe("Es mi propio contenido, no corresponde.");
  });

  it("la consulta tiene valores por defecto y topes", () => {
    expect(listAbuseReportsQuerySchema.parse({})).toMatchObject({ status: "QUEUE", sort: "priority", page: 1, pageSize: 25 });
    expect(listAbuseReportsQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(listAbuseReportsQuerySchema.safeParse({ status: "BORRADO" }).success).toBe(false);
  });
});
