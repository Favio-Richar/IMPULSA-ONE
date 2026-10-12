import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";

// Cursos (F10.3, ADR-029): curso → módulos → lecciones, con progreso por miembro.

export const courseStatus = z.enum(["DRAFT", "PUBLISHED"]);
export const courseAccess = z.enum(["OPEN", "MEMBERS", "PLAN"]);
export const lessonKind = z.enum(["TEXT", "VIDEO"]);

/** Video de una lección tal como se guarda: proveedor + id (nunca una URL de iframe libre). */
export const lessonVideoResponse = z.object({
  provider: z.enum(["youtube", "vimeo", "tiktok"]),
  videoId: z.string(),
  vertical: z.boolean().optional(),
});

// ───────────────────────────── Panel ─────────────────────────────

export const lessonResponse = z.object({
  id: uuid,
  moduleId: uuid,
  title: z.string(),
  kind: lessonKind,
  body: z.string().nullable(),
  video: lessonVideoResponse.nullable(),
  durationMinutes: z.number().int().nullable(),
  freePreview: z.boolean(),
  position: z.number().int(),
});

export const courseModuleResponse = z.object({
  id: uuid,
  title: z.string(),
  position: z.number().int(),
  lessons: z.array(lessonResponse),
});

export const courseSummaryResponse = z.object({
  id: uuid,
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  coverUrl: z.string().nullable(),
  status: courseStatus,
  access: courseAccess,
  planIds: z.array(uuid),
  moduleCount: z.number().int(),
  lessonCount: z.number().int(),
  position: z.number().int(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const courseListResponse = z.object({ items: z.array(courseSummaryResponse) });

export const courseDetailResponse = courseSummaryResponse.extend({
  modules: z.array(courseModuleResponse),
  /** Miembros que ya completaron al menos una lección. */
  learners: z.number().int(),
  /** Lecciones completadas en total (todas las personas). */
  completions: z.number().int(),
});

// ───────────────────────────── Público ─────────────────────────────

export const publicCourseCardResponse = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  coverUrl: z.string().nullable(),
  access: courseAccess,
  lessonCount: z.number().int(),
  totalMinutes: z.number().int(),
});

export const publicCourseListResponse = z.object({ items: z.array(publicCourseCardResponse) });

export const publicLessonOutlineResponse = z.object({
  id: uuid,
  title: z.string(),
  kind: lessonKind,
  durationMinutes: z.number().int().nullable(),
  freePreview: z.boolean(),
  /** ¿La persona que pregunta puede abrir esta lección? (acceso al curso o lección de muestra). */
  available: z.boolean(),
  /** Solo con sesión de miembro. */
  completed: z.boolean(),
});

export const publicCourseResponse = publicCourseCardResponse.extend({
  modules: z.array(z.object({ id: uuid, title: z.string(), lessons: z.array(publicLessonOutlineResponse) })),
  viewer: z.object({
    /** Hay una sesión de miembro válida de este sitio. */
    signedIn: z.boolean(),
    /** Puede ver todo el contenido del curso. */
    hasAccess: z.boolean(),
    completedLessons: z.number().int(),
    percent: z.number().int(),
    /** La próxima lección a retomar (la primera sin completar a la que puede entrar), o `null`. */
    nextLessonId: uuid.nullable(),
  }),
  /** Planes que dan acceso (solo con `access = PLAN`), para ofrecer la compra. */
  plans: z.array(z.object({ id: uuid, name: z.string() })),
});

export const publicLessonResponse = z.object({
  course: z.object({ slug: z.string(), title: z.string() }),
  id: uuid,
  moduleTitle: z.string(),
  title: z.string(),
  kind: lessonKind,
  body: z.string().nullable(),
  video: lessonVideoResponse.nullable(),
  durationMinutes: z.number().int().nullable(),
  completed: z.boolean(),
  /** Se puede marcar como completada (hay sesión de miembro con acceso). */
  canTrackProgress: z.boolean(),
  previousLessonId: uuid.nullable(),
  nextLessonId: uuid.nullable(),
});

export type CourseSummaryResponse = z.infer<typeof courseSummaryResponse>;
export type CourseDetailResponse = z.infer<typeof courseDetailResponse>;
export type LessonResponse = z.infer<typeof lessonResponse>;
export type PublicCourseListResponse = z.infer<typeof publicCourseListResponse>;
export type PublicCourseResponse = z.infer<typeof publicCourseResponse>;
export type PublicLessonResponse = z.infer<typeof publicLessonResponse>;

/** Resultado de marcar o desmarcar una lección: el avance del curso al día. */
export const courseProgressResponse = z.object({
  completed: z.boolean(),
  completedLessons: z.number().int(),
  totalLessons: z.number().int(),
  percent: z.number().int(),
});
export type CourseProgressResponse = z.infer<typeof courseProgressResponse>;
