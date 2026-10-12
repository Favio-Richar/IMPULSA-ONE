import { Container } from "@impulza/blocks-renderer";
import type { Metadata } from "next";
import { COURSE_ACCESS_LABELS } from "@impulza/validation";
import { getCourses, formatMinutes } from "../../../lib/courses";

// Cursos del sitio (F10.3): el listado es público; el contenido de cada lección lo decide la API según la sesión del miembro.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Cursos" };

export default async function CoursesPage({ params }: { params: Promise<{ siteSlug: string }> }) {
  const { siteSlug } = await params;
  const result = await getCourses(siteSlug);

  return (
    <Container className="py-8">
      <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--site-font-heading)" }}>
        Cursos
      </h1>
      {result === "unavailable" ? (
        <p role="status" className="mt-4 text-sm text-[var(--site-color-muted-foreground)]">
          No pudimos cargar los cursos ahora. Intenta de nuevo en un momento.
        </p>
      ) : result.items.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--site-color-muted-foreground)]">Todavía no hay cursos publicados.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {result.items.map((course) => (
            <li key={course.slug}>
              <a
                href={`/${siteSlug}/c/${course.slug}`}
                className="flex flex-col overflow-hidden rounded-[var(--site-radius)] border border-[var(--site-color-border)] shadow-[var(--site-shadow)] hover:border-[var(--site-color-foreground)]"
              >
                {course.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={course.coverUrl} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                ) : null}
                <span className="flex flex-col gap-1 p-4">
                  <span className="text-base font-semibold text-[var(--site-color-foreground)]">{course.title}</span>
                  {course.summary ? <span className="text-sm text-[var(--site-color-muted-foreground)]">{course.summary}</span> : null}
                  <span className="text-xs text-[var(--site-color-muted-foreground)]">
                    {course.lessonCount} {course.lessonCount === 1 ? "lección" : "lecciones"}
                    {course.totalMinutes > 0 ? ` · ${formatMinutes(course.totalMinutes)}` : ""} · {COURSE_ACCESS_LABELS[course.access]}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
