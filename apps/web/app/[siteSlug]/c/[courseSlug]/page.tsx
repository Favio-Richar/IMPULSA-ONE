import { Container } from "@impulza/blocks-renderer";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMinutes, getCourse } from "../../../../lib/courses";

// Temario de un curso y el avance de quien lo mira (F10.3). Sin caché: depende de la sesión del miembro.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ siteSlug: string; courseSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { siteSlug, courseSlug } = await params;
  const course = await getCourse(siteSlug, courseSlug);
  if (!course || course === "unavailable") return { title: "Curso" };
  return { title: course.title, ...(course.summary ? { description: course.summary } : {}) };
}

export default async function CoursePage({ params }: Props) {
  const { siteSlug, courseSlug } = await params;
  const course = await getCourse(siteSlug, courseSlug);
  if (course === null) notFound();
  if (course === "unavailable") {
    return (
      <Container className="py-8">
        <p role="status" className="text-sm text-[var(--site-color-muted-foreground)]">
          No pudimos cargar el curso ahora. Intenta de nuevo en un momento.
        </p>
      </Container>
    );
  }

  const lessons = course.modules.flatMap((module) => module.lessons);
  const first = lessons.find((lesson) => lesson.available) ?? lessons[0];
  const resumeId = course.viewer.nextLessonId ?? first?.id ?? null;
  const finished = course.viewer.signedIn && course.viewer.hasAccess && lessons.length > 0 && course.viewer.completedLessons === lessons.length;

  return (
    <Container className="py-8">
      <a href={`/${siteSlug}/c`} className="text-sm text-[var(--site-color-muted-foreground)] hover:text-[var(--site-color-foreground)]">
        ← Todos los cursos
      </a>
      {course.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={course.coverUrl} alt="" className="mt-4 aspect-video w-full rounded-[var(--site-radius)] border border-[var(--site-color-border)] object-cover" />
      ) : null}
      <h1 className="mt-4 text-2xl font-semibold" style={{ fontFamily: "var(--site-font-heading)" }}>
        {course.title}
      </h1>
      {course.summary ? <p className="mt-2 text-sm text-[var(--site-color-muted-foreground)]">{course.summary}</p> : null}
      <p className="mt-2 text-xs text-[var(--site-color-muted-foreground)]">
        {course.lessonCount} {course.lessonCount === 1 ? "lección" : "lecciones"}
        {course.totalMinutes > 0 ? ` · ${formatMinutes(course.totalMinutes)}` : ""}
      </p>

      {course.viewer.signedIn && course.viewer.hasAccess ? (
        <div className="mt-4">
          <div
            role="progressbar"
            aria-label="Tu avance"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={course.viewer.percent}
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--site-color-border)]"
          >
            <div className="h-full bg-[var(--site-color-primary)]" style={{ width: `${course.viewer.percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-[var(--site-color-muted-foreground)]">
            {finished ? "¡Terminaste el curso!" : `${course.viewer.completedLessons} de ${lessons.length} completadas (${course.viewer.percent}%)`}
          </p>
        </div>
      ) : !course.viewer.hasAccess ? (
        <p className="mt-4 rounded-[var(--site-radius)] border border-[var(--site-color-border)] p-3 text-sm text-[var(--site-color-foreground)]">
          {course.viewer.signedIn
            ? "Tu membresía no incluye este curso."
            : course.access === "OPEN"
              ? "Entra con tu enlace de miembro para guardar tu avance."
              : "Este curso es para miembros. Puedes ver las lecciones de muestra; para el resto, entra con tu enlace de miembro."}
          {course.plans.length > 0 ? ` Se incluye con: ${course.plans.map((plan) => plan.name).join(", ")}.` : ""}
        </p>
      ) : null}

      {resumeId ? (
        <a
          href={`/${siteSlug}/c/${course.slug}/${resumeId}`}
          className="mt-5 inline-flex min-h-11 items-center rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 text-sm font-semibold text-[var(--site-color-primary-foreground)]"
        >
          {finished ? "Repasar el curso" : course.viewer.completedLessons > 0 ? "Continuar" : "Empezar"}
        </a>
      ) : null}

      <ol className="mt-8 flex flex-col gap-6">
        {course.modules.map((module, index) => (
          <li key={module.id}>
            <h2 className="text-base font-semibold" style={{ fontFamily: "var(--site-font-heading)" }}>
              {index + 1}. {module.title}
            </h2>
            <ul className="mt-2 flex flex-col divide-y divide-[var(--site-color-border)] rounded-[var(--site-radius)] border border-[var(--site-color-border)]">
              {module.lessons.map((lesson) => (
                <li key={lesson.id} className="flex items-center gap-3 p-3 text-sm">
                  <span aria-hidden="true" className="w-5 text-center">
                    {lesson.completed ? "✓" : lesson.available ? "○" : "🔒"}
                  </span>
                  <a href={`/${siteSlug}/c/${course.slug}/${lesson.id}`} className="min-w-0 flex-1 text-[var(--site-color-foreground)] hover:underline">
                    {lesson.title}
                    {lesson.completed ? <span className="sr-only"> (completada)</span> : null}
                    {!lesson.available ? <span className="sr-only"> (bloqueada)</span> : null}
                  </a>
                  <span className="shrink-0 text-xs text-[var(--site-color-muted-foreground)]">
                    {lesson.freePreview && !course.viewer.hasAccess ? "De muestra · " : ""}
                    {lesson.kind === "VIDEO" ? "Video" : "Texto"}
                    {lesson.durationMinutes ? ` · ${lesson.durationMinutes} min` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Container>
  );
}
