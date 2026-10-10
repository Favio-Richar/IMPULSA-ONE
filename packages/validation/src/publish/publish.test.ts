import { describe, expect, it } from "vitest";
import {
  approvePublishRequestSchema,
  createPublishRequestSchema,
  publishGate,
  publishRequestListQuerySchema,
  publishSettingsSchema,
  rejectPublishRequestSchema,
  reviewVerdict,
} from "./index.js";

const UUID = "5b0d7a3e-8f5a-4f0e-9d3a-2d6a9a1c7e11";

describe("publishGate", () => {
  it.each([
    [false, false, "DIRECT"],
    [false, true, "DIRECT"],
    [true, true, "DIRECT"],
    [true, false, "NEEDS_APPROVAL"],
  ] as const)("exigida=%s, puede aprobar=%s → %s", (requireApproval, actorCanApprove, mode) => {
    expect(publishGate({ requireApproval, actorCanApprove }).mode).toBe(mode);
  });
});

describe("reviewVerdict", () => {
  it("permite a otra persona resolver una pendiente", () => {
    expect(reviewVerdict({ actorId: "a", requestedById: "b", status: "PENDING" })).toEqual({ allowed: true });
  });
  it("nadie resuelve su propia solicitud", () => {
    expect(reviewVerdict({ actorId: "a", requestedById: "a", status: "PENDING" })).toMatchObject({ allowed: false, code: "SELF_REVIEW" });
  });
  it.each(["APPROVED", "REJECTED", "CANCELLED"] as const)("una solicitud %s ya no se resuelve", (status) => {
    expect(reviewVerdict({ actorId: "a", requestedById: "b", status })).toMatchObject({ allowed: false, code: "NOT_PENDING" });
  });
  it("una solicitud sin autor (usuario borrado) la resuelve cualquiera con permiso", () => {
    expect(reviewVerdict({ actorId: "a", requestedById: null, status: "PENDING" })).toEqual({ allowed: true });
  });
});

describe("createPublishRequestSchema", () => {
  it("por defecto pide publicar el contenido actual, sin versión", () => {
    expect(createPublishRequestSchema.parse({})).toEqual({ kind: "PUBLISH", versionId: null, comment: null });
  });
  it("recorta el comentario y lo vuelve null si queda vacío", () => {
    expect(createPublishRequestSchema.parse({ comment: "  Listo para revisar  " }).comment).toBe("Listo para revisar");
    expect(createPublishRequestSchema.parse({ comment: "   " }).comment).toBeNull();
  });
  it("restaurar exige la versión; publicar no la admite", () => {
    expect(createPublishRequestSchema.safeParse({ kind: "RESTORE" }).success).toBe(false);
    expect(createPublishRequestSchema.safeParse({ kind: "RESTORE", versionId: UUID }).success).toBe(true);
    expect(createPublishRequestSchema.safeParse({ kind: "PUBLISH", versionId: UUID }).success).toBe(false);
  });
  it("rechaza comentarios largos y versiones que no son UUID", () => {
    expect(createPublishRequestSchema.safeParse({ comment: "x".repeat(501) }).success).toBe(false);
    expect(createPublishRequestSchema.safeParse({ kind: "RESTORE", versionId: "no" }).success).toBe(false);
  });
});

describe("resolución", () => {
  it("aprobar admite comentario opcional", () => {
    expect(approvePublishRequestSchema.parse({})).toEqual({ comment: null });
    expect(approvePublishRequestSchema.parse({ comment: " Bien " })).toEqual({ comment: "Bien" });
  });
  it("rechazar exige un motivo", () => {
    expect(rejectPublishRequestSchema.safeParse({}).success).toBe(false);
    expect(rejectPublishRequestSchema.safeParse({ comment: "  " }).success).toBe(false);
    expect(rejectPublishRequestSchema.parse({ comment: " Falta el precio " }).comment).toBe("Falta el precio");
  });
});

describe("opciones y consulta", () => {
  it("la opción es un booleano estricto", () => {
    expect(publishSettingsSchema.safeParse({ requireApproval: true }).success).toBe(true);
    expect(publishSettingsSchema.safeParse({ requireApproval: "true" }).success).toBe(false);
    expect(publishSettingsSchema.safeParse({}).success).toBe(false);
  });
  it("la lista pagina en servidor con topes", () => {
    expect(publishRequestListQuerySchema.parse({})).toEqual({ limit: 25, offset: 0 });
    expect(publishRequestListQuerySchema.parse({ limit: "10", offset: "20", status: "PENDING" })).toEqual({ limit: 10, offset: 20, status: "PENDING" });
    expect(publishRequestListQuerySchema.safeParse({ limit: 1000 }).success).toBe(false);
    expect(publishRequestListQuerySchema.safeParse({ status: "OTRO" }).success).toBe(false);
  });
});
