import { describe, expect, it } from "vitest";
import { REPORT_COMMENT_BODY_MAX, createReportCommentSchema } from "./comments.js";

describe("comentarios del informe", () => {
  it("recorta el texto y rechaza vacío o demasiado largo", () => {
    expect(createReportCommentSchema.parse({ body: "  Subió el tráfico  " })).toEqual({ body: "Subió el tráfico" });
    expect(createReportCommentSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(createReportCommentSchema.safeParse({ body: "a".repeat(REPORT_COMMENT_BODY_MAX + 1) }).success).toBe(false);
    expect(createReportCommentSchema.safeParse({ body: "a".repeat(REPORT_COMMENT_BODY_MAX) }).success).toBe(true);
  });
});
