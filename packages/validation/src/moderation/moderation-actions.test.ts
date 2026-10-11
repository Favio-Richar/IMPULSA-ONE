import { describe, expect, it } from "vitest";
import {
  ABUSE_REPORT_STATUSES,
  MODERATION_ACTIONS,
  availableModerationActions,
  listAbuseReportsQuerySchema,
  moderationActionSchema,
  moderationTransition,
  statusesAllowing,
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
      for (const action of MODERATION_ACTIONS) {
        expect(moderationTransition(status, action)).not.toBe("OPEN");
      }
    }
  });

  it("una apelación reabre el caso: se puede decidir de nuevo", () => {
    expect(availableModerationActions("APPEALED")).toEqual(["dismiss", "warn", "unpublish", "suspend"]);
  });

  it("no se puede restaurar lo que no tiene medida ni suspender dos veces", () => {
    expect(moderationTransition("OPEN", "restore")).toBeNull();
    expect(moderationTransition("ORG_SUSPENDED", "suspend")).toBeNull();
    expect(moderationTransition("SITE_UNPUBLISHED", "unpublish")).toBeNull();
  });

  it("statusesAllowing coincide con la tabla de transiciones", () => {
    for (const action of MODERATION_ACTIONS) {
      for (const status of ABUSE_REPORT_STATUSES) {
        expect(statusesAllowing(action).includes(status)).toBe(moderationTransition(status, action) !== null);
      }
    }
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

  it("la consulta tiene valores por defecto y topes", () => {
    expect(listAbuseReportsQuerySchema.parse({})).toMatchObject({ status: "QUEUE", sort: "priority", page: 1, pageSize: 25 });
    expect(listAbuseReportsQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(listAbuseReportsQuerySchema.safeParse({ status: "BORRADO" }).success).toBe(false);
  });
});
