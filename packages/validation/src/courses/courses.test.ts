import { describe, expect, it } from "vitest";
import { canAccessCourse, courseProgressPercent, courseSlugFromTitle, createLessonSchema, nextLessonToResume, updateCourseSchema } from "./index.js";

const NOW = new Date("2026-10-12T12:00:00Z");
const future = new Date("2026-11-12T12:00:00Z");
const past = new Date("2026-09-01T12:00:00Z");
const paid = (planId: string, over: Partial<{ periodEnd: Date | null; refundedAmount: number; paymentStatus: string | null }> = {}) => ({
  planId,
  status: "PAID" as const,
  paymentStatus: "approved" as string | null,
  amount: 1000,
  refundedAmount: 0,
  periodEnd: future as Date | null,
  ...over,
});

describe("acceso a cursos (F10.3)", () => {
  it("un curso abierto es para cualquiera, con o sin sesión", () => {
    expect(canAccessCourse({ access: "OPEN", planIds: [] }, null, NOW)).toBe(true);
  });

  it("MEMBERS: invitado activo entra; quien pagó entra solo con un periodo vigente; sin sesión no", () => {
    const course = { access: "MEMBERS" as const, planIds: [] };
    expect(canAccessCourse(course, null, NOW)).toBe(false);
    expect(canAccessCourse(course, { source: "INVITED", purchases: [] }, NOW)).toBe(true);
    expect(canAccessCourse(course, { source: "PURCHASED", purchases: [paid("a")] }, NOW)).toBe(true);
    expect(canAccessCourse(course, { source: "PURCHASED", purchases: [paid("a", { periodEnd: past })] }, NOW)).toBe(false);
    expect(canAccessCourse(course, { source: "PURCHASED", purchases: [] }, NOW)).toBe(false);
  });

  it("PLAN: exige un periodo vigente de uno de sus planes; un invitado sin compra o un plan ajeno no entran", () => {
    const course = { access: "PLAN" as const, planIds: ["a", "b"] };
    expect(canAccessCourse(course, { source: "INVITED", purchases: [] }, NOW)).toBe(false);
    expect(canAccessCourse(course, { source: "PURCHASED", purchases: [paid("zzz")] }, NOW)).toBe(false);
    expect(canAccessCourse(course, { source: "PURCHASED", purchases: [paid("b")] }, NOW)).toBe(true);
    // Reembolso total o pago no aprobado: no da acceso.
    expect(canAccessCourse(course, { source: "PURCHASED", purchases: [paid("a", { refundedAmount: 1000 })] }, NOW)).toBe(false);
    expect(canAccessCourse(course, { source: "PURCHASED", purchases: [paid("a", { paymentStatus: "charged_back" })] }, NOW)).toBe(false);
    // Un invitado que además compró el plan sí entra.
    expect(canAccessCourse(course, { source: "INVITED", purchases: [paid("a")] }, NOW)).toBe(true);
  });
});

describe("progreso y reanudación (F10.3)", () => {
  it("el porcentaje es entero, nunca pasa de 100 y un curso vacío es 0", () => {
    expect(courseProgressPercent(0, 0)).toBe(0);
    expect(courseProgressPercent(3, 1)).toBe(33);
    expect(courseProgressPercent(3, 2)).toBe(67);
    expect(courseProgressPercent(3, 9)).toBe(100);
    expect(courseProgressPercent(3, -1)).toBe(0);
  });

  it("retoma en la primera lección sin completar, según el orden del curso", () => {
    expect(nextLessonToResume(["a", "b", "c"], new Set(["a", "c"]))).toBe("b");
    expect(nextLessonToResume(["a", "b"], new Set(["a", "b"]))).toBeNull();
    expect(nextLessonToResume([], new Set())).toBeNull();
  });
});

describe("datos de curso y lección (F10.3)", () => {
  it("la dirección se arma sin tildes ni símbolos y siempre cumple el mínimo", () => {
    expect(courseSlugFromTitle("Fotografía & Retrato: ¡Nivel 1!")).toBe("fotografia-retrato-nivel-1");
    expect(courseSlugFromTitle("A")).toBe("curso-a");
    expect(courseSlugFromTitle("???")).toBe("curso-nuevo");
  });

  it("una lección de video necesita un video de proveedor permitido; una de texto, contenido real", () => {
    expect(createLessonSchema.safeParse({ title: "V", kind: "VIDEO" }).success).toBe(false);
    expect(createLessonSchema.safeParse({ title: "V", kind: "VIDEO", video: "https://evil.example/x" }).success).toBe(false);
    expect(createLessonSchema.safeParse({ title: "V", kind: "VIDEO", video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }).success).toBe(true);
    expect(createLessonSchema.safeParse({ title: "T", kind: "TEXT", body: "<p>  </p>" }).success).toBe(false);
    expect(createLessonSchema.safeParse({ title: "T", kind: "TEXT", body: "<p>Hola</p>" }).success).toBe(true);
  });

  it("rechaza campos desconocidos y cambios vacíos", () => {
    expect(updateCourseSchema.safeParse({}).success).toBe(false);
    expect(updateCourseSchema.safeParse({ organizationId: "x", title: "Hola" }).success).toBe(false);
  });
});
