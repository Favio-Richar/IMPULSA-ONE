import type { PublicCourseListResponse, PublicCourseResponse, PublicLessonResponse } from "@impulza/contracts";
import { publicCourseListResponse, publicCourseResponse, publicLessonResponse } from "@impulza/contracts";
import { memberCookieName } from "@impulza/validation";
import { cookies } from "next/headers";
import { env } from "./env";
import { fetchUpstream } from "./upstream";

// Cursos del sitio público (F10.3). Siempre del lado del servidor y sin caché: el acceso depende de la sesión del miembro, y la
// API es quien decide qué lecciones se entregan. La cookie nunca llega al navegador como dato: solo se reenvía a la API.

async function sessionHeaders(siteSlug: string): Promise<Record<string, string>> {
  const token = (await cookies()).get(memberCookieName(siteSlug))?.value;
  return { "X-Requested-With": "impulza-one", ...(token ? { "x-member-session": token } : {}) };
}

const root = (siteSlug: string): string => `${env.API_BASE_URL}/public/sites/${encodeURIComponent(siteSlug)}/courses`;

/** Cursos publicados. Ante cualquier falla, sin cursos (la página muestra su estado vacío). */
export async function getCourses(siteSlug: string): Promise<PublicCourseListResponse | "unavailable"> {
  const response = await fetchUpstream("courses-list", root(siteSlug), { headers: await sessionHeaders(siteSlug), cache: "no-store" });
  if (!response || !response.ok) return "unavailable";
  return publicCourseListResponse.parse(await response.json());
}

/** Temario y avance. `null` = el curso no existe o no está publicado. */
export async function getCourse(siteSlug: string, courseSlug: string): Promise<PublicCourseResponse | null | "unavailable"> {
  const response = await fetchUpstream("course", `${root(siteSlug)}/${encodeURIComponent(courseSlug)}`, { headers: await sessionHeaders(siteSlug), cache: "no-store" });
  if (!response) return "unavailable";
  if (response.status === 404) return null;
  if (!response.ok) return "unavailable";
  return publicCourseResponse.parse(await response.json());
}

export type LessonResult =
  | { kind: "ok"; lesson: PublicLessonResponse }
  | { kind: "locked"; signedIn: boolean }
  | { kind: "none" }
  | { kind: "unavailable" };

/** Una lección. `locked` = existe pero esta persona no tiene acceso (no se entrega nada del contenido). */
export async function getLesson(siteSlug: string, courseSlug: string, lessonId: string): Promise<LessonResult> {
  const headers = await sessionHeaders(siteSlug);
  const response = await fetchUpstream("lesson", `${root(siteSlug)}/${encodeURIComponent(courseSlug)}/lessons/${encodeURIComponent(lessonId)}`, { headers, cache: "no-store" });
  if (!response) return { kind: "unavailable" };
  if (response.status === 403) return { kind: "locked", signedIn: "x-member-session" in headers };
  if (response.status === 404) return { kind: "none" };
  if (!response.ok) return { kind: "unavailable" };
  return { kind: "ok", lesson: publicLessonResponse.parse(await response.json()) };
}

/** Minutos como «1 h 20 min». */
export function formatMinutes(total: number): string {
  if (total <= 0) return "";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
