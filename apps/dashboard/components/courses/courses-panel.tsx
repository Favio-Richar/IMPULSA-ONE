"use client";

import type { CourseSummaryResponse } from "@impulza/contracts";
import { COURSE_ACCESS_LABELS, COURSE_TITLE_MAX, type CourseAccessMode } from "@impulza/validation";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "../../lib/api-client";
import { createCourse, listCourses } from "../../lib/api/courses";

export function courseErrorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
    const body = error.body as { message?: unknown; issues?: Array<{ message?: string }> };
    if (Array.isArray(body.issues) && body.issues[0]?.message) return body.issues[0].message;
    if (typeof body.message === "string") return body.message;
  }
  return fallback;
}

export const COURSE_STATUS_LABEL = { DRAFT: "Borrador", PUBLISHED: "Publicado" } as const;

/** Cursos del sitio y alta de uno nuevo (F10.3). Cada curso se arma en su propio editor. */
export function CoursesPanel({ organizationId, siteId }: { organizationId: string; siteId: string }): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["courses", organizationId, siteId], queryFn: () => listCourses(organizationId, siteId) });
  const [title, setTitle] = useState("");
  const [access, setAccess] = useState<CourseAccessMode>("MEMBERS");
  const [invalid, setInvalid] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createCourse(organizationId, siteId, { title: title.trim(), access: access === "PLAN" ? "MEMBERS" : access, planIds: [] }),
    onSuccess: (course) => {
      void queryClient.invalidateQueries({ queryKey: ["courses", organizationId, siteId] });
      router.push(`/sitios/${siteId}/cursos/${course.id}`);
    },
  });

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    if (title.trim().length < 2) return setInvalid("Ponle un nombre al curso.");
    setInvalid(null);
    create.mutate();
  }

  return (
    <section aria-labelledby="cursos" className="flex flex-col gap-4">
      <h2 id="cursos" className="sr-only">
        Tus cursos
      </h2>
      {query.isPending ? (
        <LoadingState label="Cargando tus cursos…" />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState title="Todavía no tienes cursos" description="Crea el primero abajo: lo armas con módulos y lecciones de texto o video, y decides quién lo ve." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-background">
          {query.data.items.map((course) => (
            <CourseRow key={course.id} course={course} siteId={siteId} />
          ))}
        </ul>
      )}

      <form noValidate onSubmit={submit} aria-label="Crear curso" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
        <Input label="Nombre del curso" value={title} maxLength={COURSE_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} required />
        <label className="flex flex-col gap-1 text-sm text-foreground">
          ¿Quién puede verlo?
          <select
            value={access}
            onChange={(event) => setAccess(event.target.value as CourseAccessMode)}
            className="min-h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            <option value="OPEN">{COURSE_ACCESS_LABELS.OPEN}</option>
            <option value="MEMBERS">{COURSE_ACCESS_LABELS.MEMBERS}</option>
          </select>
          <span className="text-xs text-muted-foreground">Para limitarlo a ciertos planes de membresía, lo eliges después, dentro del curso.</span>
        </label>
        {invalid ? (
          <p role="alert" className="text-sm text-danger">
            {invalid}
          </p>
        ) : null}
        {create.isError ? (
          <p role="alert" className="text-sm text-danger">
            {courseErrorText(create.error, "No pudimos crear el curso. Intenta de nuevo.")}
          </p>
        ) : null}
        <div>
          <Button type="submit" loading={create.isPending}>
            Crear curso
          </Button>
        </div>
      </form>
    </section>
  );
}

function CourseRow({ course, siteId }: { course: CourseSummaryResponse; siteId: string }): React.JSX.Element {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <Link href={`/sitios/${siteId}/cursos/${course.id}`} className="font-medium text-foreground hover:underline">
          {course.title}
        </Link>
        <p className="text-xs text-muted-foreground">
          {course.moduleCount} {course.moduleCount === 1 ? "módulo" : "módulos"} · {course.lessonCount} {course.lessonCount === 1 ? "lección" : "lecciones"} ·{" "}
          {COURSE_ACCESS_LABELS[course.access]}
        </p>
      </div>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${course.status === "PUBLISHED" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
      >
        {COURSE_STATUS_LABEL[course.status]}
      </span>
    </li>
  );
}
