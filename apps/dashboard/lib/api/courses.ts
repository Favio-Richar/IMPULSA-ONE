import type { CourseDetailResponse, CourseSummaryResponse } from "@impulza/contracts";
import { apiFetch } from "../api-client";

// Cursos de un sitio, desde el panel (F10.3, ADR-029).

const base = (organizationId: string, siteId: string): string => `/organizations/${organizationId}/sites/${siteId}/courses`;

export type CourseCreateInput = { title: string; access: "OPEN" | "MEMBERS" | "PLAN"; planIds: string[]; summary?: string };
export type CourseChanges = Partial<{
  title: string;
  slug: string;
  summary: string | null;
  coverUrl: string | null;
  access: "OPEN" | "MEMBERS" | "PLAN";
  planIds: string[];
  status: "DRAFT" | "PUBLISHED";
}>;
export type LessonInput = {
  title: string;
  kind: "TEXT" | "VIDEO";
  body?: string | null;
  video?: string | null;
  durationMinutes?: number | null;
  freePreview: boolean;
};

export function listCourses(organizationId: string, siteId: string): Promise<{ items: CourseSummaryResponse[] }> {
  return apiFetch<{ items: CourseSummaryResponse[] }>(base(organizationId, siteId));
}

export function getCourse(organizationId: string, siteId: string, courseId: string): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(`${base(organizationId, siteId)}/${courseId}`);
}

export function createCourse(organizationId: string, siteId: string, body: CourseCreateInput): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(base(organizationId, siteId), { method: "POST", body });
}

export function updateCourse(organizationId: string, siteId: string, courseId: string, body: CourseChanges): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(`${base(organizationId, siteId)}/${courseId}`, { method: "PATCH", body });
}

export function deleteCourse(organizationId: string, siteId: string, courseId: string): Promise<void> {
  return apiFetch<void>(`${base(organizationId, siteId)}/${courseId}`, { method: "DELETE" });
}

export function addCourseModule(organizationId: string, siteId: string, courseId: string, title: string): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(`${base(organizationId, siteId)}/${courseId}/modules`, { method: "POST", body: { title } });
}

export function renameCourseModule(organizationId: string, siteId: string, courseId: string, moduleId: string, title: string): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(`${base(organizationId, siteId)}/${courseId}/modules/${moduleId}`, { method: "PATCH", body: { title } });
}

export function removeCourseModule(organizationId: string, siteId: string, courseId: string, moduleId: string): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(`${base(organizationId, siteId)}/${courseId}/modules/${moduleId}`, { method: "DELETE" });
}

export function reorderCourseModules(organizationId: string, siteId: string, courseId: string, ids: string[]): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(`${base(organizationId, siteId)}/${courseId}/modules/order`, { method: "PUT", body: { ids } });
}

export function addLesson(organizationId: string, siteId: string, courseId: string, moduleId: string, body: LessonInput): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(`${base(organizationId, siteId)}/${courseId}/modules/${moduleId}/lessons`, { method: "POST", body });
}

export function updateLesson(
  organizationId: string,
  siteId: string,
  courseId: string,
  lessonId: string,
  body: Partial<LessonInput> & { moduleId?: string },
): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(`${base(organizationId, siteId)}/${courseId}/lessons/${lessonId}`, { method: "PATCH", body });
}

export function removeLesson(organizationId: string, siteId: string, courseId: string, lessonId: string): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(`${base(organizationId, siteId)}/${courseId}/lessons/${lessonId}`, { method: "DELETE" });
}

export function reorderLessons(organizationId: string, siteId: string, courseId: string, moduleId: string, ids: string[]): Promise<CourseDetailResponse> {
  return apiFetch<CourseDetailResponse>(`${base(organizationId, siteId)}/${courseId}/modules/${moduleId}/lessons/order`, { method: "PUT", body: { ids } });
}
