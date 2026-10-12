import { z } from "zod";
import { richTextSchema, safeUrlSchema, storedVideoSchema, videoEmbedSchema } from "../blocks/primitives.js";
import { cleanPlainText } from "../moderation/abuse-report.js";
import { slugSchema } from "../slug.js";
import { purchaseGrantsAccess, type PurchaseForAccess } from "../members/index.js";

/**
 * Cursos (F10.3, ADR-029): curso → módulos → lecciones, con progreso por miembro. Reglas compartidas por la API, `apps/web` y el
 * panel. El servidor vuelve a aplicarlas siempre: ninguna decisión de acceso sale del frontend.
 */

export const COURSES_PER_SITE_MAX = 50;
export const MODULES_PER_COURSE_MAX = 30;
export const LESSONS_PER_MODULE_MAX = 60;
export const COURSE_PLANS_MAX = 10;
export const COURSE_TITLE_MAX = 120;
export const COURSE_SUMMARY_MAX = 400;
export const LESSON_DURATION_MAX_MINUTES = 600;

export const COURSE_ACCESS = ["OPEN", "MEMBERS", "PLAN"] as const;
export type CourseAccessMode = (typeof COURSE_ACCESS)[number];
export const COURSE_STATUS = ["DRAFT", "PUBLISHED"] as const;
export const LESSON_KINDS = ["TEXT", "VIDEO"] as const;
export type LessonKindValue = (typeof LESSON_KINDS)[number];

export const COURSE_ACCESS_LABELS: Record<CourseAccessMode, string> = {
  OPEN: "Abierto para todos",
  MEMBERS: "Para miembros con acceso vigente",
  PLAN: "Solo para ciertos planes de membresía",
};

const plain = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanPlainText)
    .pipe(z.string().min(1, "Escribe un texto.").max(max, `Máximo ${max} caracteres.`));

const optionalPlain = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(cleanPlainText)
    .pipe(z.string().max(max, `Máximo ${max} caracteres.`));

const planIdsSchema = z.array(z.uuid()).max(COURSE_PLANS_MAX).transform((ids) => [...new Set(ids)]);

const courseFields = {
  title: plain(COURSE_TITLE_MAX),
  slug: slugSchema,
  summary: optionalPlain(COURSE_SUMMARY_MAX).nullable(),
  coverUrl: safeUrlSchema.nullable(),
  access: z.enum(COURSE_ACCESS),
  planIds: planIdsSchema,
};

/** Alta de un curso: nace en borrador. Sin `slug`, el servidor lo arma desde el título. */
export const createCourseSchema = z
  .object({
    title: courseFields.title,
    slug: courseFields.slug.optional(),
    summary: courseFields.summary.optional(),
    coverUrl: courseFields.coverUrl.optional(),
    access: courseFields.access.default("MEMBERS"),
    planIds: courseFields.planIds.default([]),
  })
  .strict();
export type CreateCourseDto = z.infer<typeof createCourseSchema>;

export const updateCourseSchema = z
  .object({
    title: courseFields.title.optional(),
    slug: courseFields.slug.optional(),
    summary: courseFields.summary.optional(),
    coverUrl: courseFields.coverUrl.optional(),
    access: courseFields.access.optional(),
    planIds: courseFields.planIds.optional(),
    status: z.enum(COURSE_STATUS).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "No hay nada que cambiar." });
export type UpdateCourseDto = z.infer<typeof updateCourseSchema>;

export const courseModuleSchema = z.object({ title: plain(COURSE_TITLE_MAX) }).strict();
export type CourseModuleDto = z.infer<typeof courseModuleSchema>;

const lessonBase = {
  title: plain(COURSE_TITLE_MAX),
  kind: z.enum(LESSON_KINDS),
  body: richTextSchema.nullable(),
  video: videoEmbedSchema.nullable(),
  durationMinutes: z.number().int().min(1).max(LESSON_DURATION_MAX_MINUTES).nullable(),
  freePreview: z.boolean(),
};

/** Una lección de video necesita su video; una de texto, algo que leer. */
function lessonContentIssue(value: { kind?: LessonKindValue; body?: string | null; video?: unknown }): string | null {
  if (value.kind === "VIDEO" && !value.video) return "Pega el enlace del video de la lección.";
  if (value.kind === "TEXT" && (!value.body || value.body.replace(/<[^>]*>/g, "").trim().length === 0)) return "Escribe el contenido de la lección.";
  return null;
}

export const createLessonSchema = z
  .object({
    title: lessonBase.title,
    kind: lessonBase.kind.default("TEXT"),
    body: lessonBase.body.optional(),
    video: lessonBase.video.optional(),
    durationMinutes: lessonBase.durationMinutes.optional(),
    freePreview: lessonBase.freePreview.default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = lessonContentIssue(value);
    if (issue) ctx.addIssue({ code: "custom", message: issue, path: [value.kind === "VIDEO" ? "video" : "body"] });
  });
export type CreateLessonDto = z.infer<typeof createLessonSchema>;

export const updateLessonSchema = z
  .object({
    title: lessonBase.title.optional(),
    kind: lessonBase.kind.optional(),
    body: lessonBase.body.optional(),
    video: lessonBase.video.optional(),
    durationMinutes: lessonBase.durationMinutes.optional(),
    freePreview: lessonBase.freePreview.optional(),
    moduleId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "No hay nada que cambiar." });
export type UpdateLessonDto = z.infer<typeof updateLessonSchema>;

export const reorderIdsSchema = z.object({ ids: z.array(z.uuid()).min(1).max(LESSONS_PER_MODULE_MAX) }).strict();
export type ReorderIdsDto = z.infer<typeof reorderIdsSchema>;

/** Lección ya guardada: lo que sobrevive en la base (`video` con la forma normalizada). */
export const storedLessonVideoSchema = storedVideoSchema;
export { lessonContentIssue };

/** Slug propuesto para un título: minúsculas, sin tildes, guiones; mínimo 3 caracteres. */
export function courseSlugFromTitle(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `curso-${base || "nuevo"}`.slice(0, 50);
}

// ───────────────────────────── Acceso ─────────────────────────────

export interface CourseAccessInput {
  access: CourseAccessMode;
  /** Planes que dan acceso (solo importa con `access = PLAN`). */
  planIds: readonly string[];
}

export interface MemberAccessInput {
  source: "INVITED" | "PURCHASED";
  /** Compras pagadas del miembro, con el plan de cada una. */
  purchases: Array<PurchaseForAccess & { planId: string }>;
}

/**
 * ¿Esta persona puede ver el contenido del curso? `member` es `null` sin sesión de miembro válida.
 * - OPEN: cualquiera.
 * - MEMBERS: un miembro con acceso vigente (invitado activo, o con un periodo pagado vigente).
 * - PLAN: un miembro con un periodo vigente de alguno de los planes del curso; un invitado sin compra NO entra.
 */
export function canAccessCourse(course: CourseAccessInput, member: MemberAccessInput | null, now: Date): boolean {
  if (course.access === "OPEN") return true;
  if (!member) return false;
  if (course.access === "MEMBERS") return member.source === "INVITED" || member.purchases.some((purchase) => purchaseGrantsAccess(purchase, now));
  return member.purchases.some((purchase) => course.planIds.includes(purchase.planId) && purchaseGrantsAccess(purchase, now));
}

/** Porcentaje entero de lecciones completadas; 0 si el curso no tiene lecciones. */
export function courseProgressPercent(totalLessons: number, completedLessons: number): number {
  if (totalLessons <= 0) return 0;
  return Math.min(100, Math.round((Math.max(0, completedLessons) / totalLessons) * 100));
}

/** Siguiente lección a retomar: la primera sin completar según el orden del curso; `null` si terminó todo o no hay lecciones. */
export function nextLessonToResume(orderedLessonIds: readonly string[], completedIds: ReadonlySet<string>): string | null {
  return orderedLessonIds.find((id) => !completedIds.has(id)) ?? null;
}
