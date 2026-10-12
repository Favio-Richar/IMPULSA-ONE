import { Container, RichText, VideoBlock } from "@impulza/blocks-renderer";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemberGate } from "../../../../../components/member-gate";
import { LessonProgressButton } from "../../../../../components/lesson-progress-button";
import { getPublicSite } from "../../../../../lib/api";
import { getLesson } from "../../../../../lib/courses";
import { getMemberPlans } from "../../../../../lib/memberships";

// Una lección (F10.3). La API entrega el contenido solo con acceso; sin él, se muestra la puerta de miembros.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ siteSlug: string; courseSlug: string; lessonId: string }> };

export const metadata: Metadata = { title: "Lección", robots: { index: false, follow: true } };

export default async function LessonPage({ params }: Props) {
  const { siteSlug, courseSlug, lessonId } = await params;
  const result = await getLesson(siteSlug, courseSlug, lessonId);
  if (result.kind === "none") notFound();

  if (result.kind === "unavailable") {
    return (
      <Container className="py-8">
        <p role="status" className="text-sm text-[var(--site-color-muted-foreground)]">
          No pudimos cargar la lección ahora. Intenta de nuevo en un momento.
        </p>
      </Container>
    );
  }

  if (result.kind === "locked") {
    const [site, { plans, providers }] = await Promise.all([getPublicSite(siteSlug), getMemberPlans(siteSlug)]);
    return (
      <Container className="py-4">
        <a href={`/${siteSlug}/c/${courseSlug}`} className="text-sm text-[var(--site-color-muted-foreground)] hover:text-[var(--site-color-foreground)]">
          ← Volver al curso
        </a>
        <MemberGate siteSlug={siteSlug} siteName={site?.name ?? ""} plans={plans} providers={providers} inactive={result.signedIn} />
      </Container>
    );
  }

  const lesson = result.lesson;
  const base = `/${siteSlug}/c/${lesson.course.slug}`;
  const nextHref = lesson.nextLessonId ? `${base}/${lesson.nextLessonId}` : base;

  return (
    <Container className="py-8">
      <a href={base} className="text-sm text-[var(--site-color-muted-foreground)] hover:text-[var(--site-color-foreground)]">
        ← {lesson.course.title}
      </a>
      <p className="mt-4 text-xs uppercase tracking-wide text-[var(--site-color-muted-foreground)]">{lesson.moduleTitle}</p>
      <h1 className="mt-1 text-2xl font-semibold" style={{ fontFamily: "var(--site-font-heading)" }}>
        {lesson.title}
      </h1>
      {lesson.durationMinutes ? <p className="mt-1 text-xs text-[var(--site-color-muted-foreground)]">{lesson.durationMinutes} min</p> : null}

      {lesson.video ? (
        <div className="mt-5">
          <VideoBlock config={{ video: lesson.video, title: lesson.title }} />
        </div>
      ) : null}
      {lesson.body ? <RichText html={lesson.body} className="mt-5" /> : null}

      <div className="mt-8 flex flex-col gap-5">
        {lesson.canTrackProgress ? (
          <LessonProgressButton siteSlug={siteSlug} courseSlug={lesson.course.slug} lessonId={lesson.id} completed={lesson.completed} nextHref={nextHref} />
        ) : null}
        <nav aria-label="Lecciones" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          {lesson.previousLessonId ? (
            <a href={`${base}/${lesson.previousLessonId}`} className="text-[var(--site-color-foreground)] underline underline-offset-2">
              ← Anterior
            </a>
          ) : (
            <span />
          )}
          {lesson.nextLessonId ? (
            <a href={`${base}/${lesson.nextLessonId}`} className="text-[var(--site-color-foreground)] underline underline-offset-2">
              Siguiente →
            </a>
          ) : null}
        </nav>
      </div>
    </Container>
  );
}
