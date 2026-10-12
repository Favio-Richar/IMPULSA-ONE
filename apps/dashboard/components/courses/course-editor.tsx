"use client";

import type { CourseDetailResponse, LessonResponse } from "@impulza/contracts";
import { COURSE_ACCESS_LABELS, COURSE_SUMMARY_MAX, COURSE_TITLE_MAX, type CourseAccessMode } from "@impulza/validation";
import { Button, EmptyState, ErrorState, Input, LoadingState } from "@impulza/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Clock, Eye, Trash2, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addCourseModule, addLesson, deleteCourse, getCourse, removeCourseModule, removeLesson, renameCourseModule, reorderCourseModules, reorderLessons, updateCourse, updateLesson, type LessonInput } from "../../lib/api/courses";
import { listMembershipPlans } from "../../lib/api/memberships";
import { RichTextEditor } from "../block-editor/rich-text-editor";
import { ConfirmButton } from "../confirm-button";
import { MediaPicker } from "../media/media-picker";
import { courseErrorText, COURSE_STATUS_LABEL } from "./courses-panel";

const selectClass = "min-h-10 rounded-md border border-border bg-background px-2 text-sm text-foreground";

/** Editor de un curso: datos, acceso, módulos y lecciones (F10.3). Cada acción guarda en el servidor y devuelve el curso al día. */
export function CourseEditor({ organizationId, siteId, courseId }: { organizationId: string; siteId: string; courseId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const key = ["course", organizationId, siteId, courseId];
  const query = useQuery({ queryKey: key, queryFn: () => getCourse(organizationId, siteId, courseId) });
  const apply = (course: CourseDetailResponse) => {
    queryClient.setQueryData(key, course);
    void queryClient.invalidateQueries({ queryKey: ["courses", organizationId, siteId] });
  };

  if (query.isPending) return <LoadingState label="Cargando el curso…" />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  const course = query.data;

  return (
    <div className="flex flex-col gap-6">
      <CourseSettings organizationId={organizationId} siteId={siteId} course={course} onSaved={apply} />
      <section aria-labelledby="temario" className="flex flex-col gap-3">
        <div>
          <h2 id="temario" className="text-lg font-semibold text-foreground">
            Temario
          </h2>
          <p className="text-sm text-muted-foreground">Ordena con las flechas. Una lección «de muestra» la puede ver cualquiera, aunque el curso sea cerrado.</p>
        </div>
        {course.modules.length === 0 ? <EmptyState title="Todavía no hay módulos" description="Agrega el primero para empezar a sumar lecciones." /> : null}
        <ul className="flex flex-col gap-4">
          {course.modules.map((courseModule, index) => (
            <ModuleCard key={courseModule.id} organizationId={organizationId} siteId={siteId} course={course} moduleIndex={index} onChanged={apply} />
          ))}
        </ul>
        <AddModule organizationId={organizationId} siteId={siteId} courseId={courseId} onChanged={apply} />
      </section>
    </div>
  );
}

function CourseSettings({
  organizationId,
  siteId,
  course,
  onSaved,
}: {
  organizationId: string;
  siteId: string;
  course: CourseDetailResponse;
  onSaved: (course: CourseDetailResponse) => void;
}): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const plans = useQuery({ queryKey: ["membership-plans", organizationId, siteId], queryFn: () => listMembershipPlans(organizationId, siteId) });
  const [title, setTitle] = useState(course.title);
  const [slug, setSlug] = useState(course.slug);
  const [summary, setSummary] = useState(course.summary ?? "");
  const [access, setAccess] = useState<CourseAccessMode>(course.access);
  const [planIds, setPlanIds] = useState<string[]>(course.planIds);
  const [picker, setPicker] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (changes: Parameters<typeof updateCourse>[3]) => updateCourse(organizationId, siteId, course.id, changes),
    onSuccess: (updated) => {
      onSaved(updated);
      setSlug(updated.slug);
      setSaved(true);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteCourse(organizationId, siteId, course.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["courses", organizationId, siteId] });
      router.push(`/sitios/${siteId}/cursos`);
    },
  });
  const activePlans = (plans.data?.plans ?? []).filter((plan) => plan.status === "ACTIVE" || planIds.includes(plan.id));

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    setSaved(false);
    save.mutate({ title: title.trim(), slug: slug.trim(), summary: summary.trim() || null, access, planIds: access === "PLAN" ? planIds : [] });
  }

  return (
    <section aria-labelledby="datos-curso" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="datos-curso" className="text-lg font-semibold text-foreground">
          Datos del curso
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${course.status === "PUBLISHED" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
            {COURSE_STATUS_LABEL[course.status]}
          </span>
          <Button
            type="button"
            variant={course.status === "PUBLISHED" ? "secondary" : "primary"}
            size="sm"
            loading={save.isPending}
            onClick={() => {
              setSaved(false);
              save.mutate({ status: course.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED" });
            }}
          >
            {course.status === "PUBLISHED" ? "Ocultar curso" : "Publicar curso"}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {course.learners} {course.learners === 1 ? "persona ha avanzado" : "personas han avanzado"} · {course.completions} lecciones completadas en total.
      </p>

      <form noValidate onSubmit={submit} aria-label="Datos del curso" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
        <Input label="Nombre" value={title} maxLength={COURSE_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} required />
        <Input label="Dirección del curso" value={slug} onChange={(event) => setSlug(event.target.value)} helperText="Minúsculas, números y guiones. Es parte del enlace público." />
        <label className="flex flex-col gap-1 text-sm text-foreground">
          Descripción
          <textarea
            value={summary}
            maxLength={COURSE_SUMMARY_MAX}
            rows={3}
            onChange={(event) => setSummary(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          {course.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={course.coverUrl} alt="Portada del curso" className="h-16 w-28 rounded-md border border-border object-cover" />
          ) : (
            <span className="text-sm text-muted-foreground">Sin portada</span>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => setPicker(true)}>
            {course.coverUrl ? "Cambiar portada" : "Elegir portada"}
          </Button>
          {course.coverUrl ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => save.mutate({ coverUrl: null })}>
              Quitar portada
            </Button>
          ) : null}
        </div>
        <MediaPicker
          organizationId={organizationId}
          open={picker}
          onOpenChange={setPicker}
          hint="Horizontal, al menos 1200 × 675 px"
          onSelect={(asset) => {
            setPicker(false);
            save.mutate({ coverUrl: asset.url });
          }}
        />

        <label className="flex flex-col gap-1 text-sm text-foreground">
          ¿Quién puede verlo?
          <select value={access} onChange={(event) => setAccess(event.target.value as CourseAccessMode)} className={selectClass}>
            {(Object.keys(COURSE_ACCESS_LABELS) as CourseAccessMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {COURSE_ACCESS_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>

        {access === "PLAN" ? (
          <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium text-foreground">Planes que dan acceso</legend>
            {plans.isPending ? (
              <p className="text-sm text-muted-foreground">Cargando planes…</p>
            ) : activePlans.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todavía no tienes planes de membresía. Créalos en{" "}
                <Link href={`/sitios/${siteId}/miembros`} className="text-primary underline underline-offset-2">
                  Miembros
                </Link>
                .
              </p>
            ) : (
              activePlans.map((plan) => (
                <label key={plan.id} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={planIds.includes(plan.id)}
                    onChange={(event) => setPlanIds((current) => (event.target.checked ? [...current, plan.id] : current.filter((id) => id !== plan.id)))}
                  />
                  {plan.name}
                </label>
              ))
            )}
          </fieldset>
        ) : null}

        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {courseErrorText(save.error, "No pudimos guardar los cambios. Intenta de nuevo.")}
          </p>
        ) : null}
        {saved && !save.isPending ? (
          <p role="status" className="text-sm text-primary">
            Cambios guardados.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" loading={save.isPending}>
            Guardar datos
          </Button>
          <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Eliminar el curso y el avance de todos?" loading={remove.isPending} onConfirm={() => remove.mutate()}>
            <Trash2 className="size-4" aria-hidden="true" /> Eliminar curso
          </ConfirmButton>
        </div>
        {remove.isError ? (
          <p role="alert" className="text-sm text-danger">
            {courseErrorText(remove.error, "No pudimos eliminar el curso.")}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function AddModule({ organizationId, siteId, courseId, onChanged }: { organizationId: string; siteId: string; courseId: string; onChanged: (course: CourseDetailResponse) => void }): React.JSX.Element {
  const [title, setTitle] = useState("");
  const add = useMutation({
    mutationFn: () => addCourseModule(organizationId, siteId, courseId, title.trim()),
    onSuccess: (course) => {
      setTitle("");
      onChanged(course);
    },
  });
  return (
    <form
      noValidate
      aria-label="Agregar módulo"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim().length > 0) add.mutate();
      }}
    >
      <div className="min-w-0 flex-1">
        <Input label="Nuevo módulo" value={title} maxLength={COURSE_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <Button type="submit" loading={add.isPending} disabled={title.trim().length === 0}>
        Agregar módulo
      </Button>
      {add.isError ? (
        <p role="alert" className="w-full text-sm text-danger">
          {courseErrorText(add.error, "No pudimos agregar el módulo.")}
        </p>
      ) : null}
    </form>
  );
}

function ModuleCard({
  organizationId,
  siteId,
  course,
  moduleIndex,
  onChanged,
}: {
  organizationId: string;
  siteId: string;
  course: CourseDetailResponse;
  moduleIndex: number;
  onChanged: (course: CourseDetailResponse) => void;
}): React.JSX.Element {
  const courseModule = course.modules[moduleIndex]!;
  const [title, setTitle] = useState(courseModule.title);
  const [adding, setAdding] = useState(false);
  const rename = useMutation({ mutationFn: () => renameCourseModule(organizationId, siteId, course.id, courseModule.id, title.trim()), onSuccess: onChanged });
  const remove = useMutation({ mutationFn: () => removeCourseModule(organizationId, siteId, course.id, courseModule.id), onSuccess: onChanged });
  const move = useMutation({
    mutationFn: (direction: -1 | 1) => {
      const ids = course.modules.map((item) => item.id);
      const target = moduleIndex + direction;
      [ids[moduleIndex], ids[target]] = [ids[target]!, ids[moduleIndex]!];
      return reorderCourseModules(organizationId, siteId, course.id, ids);
    },
    onSuccess: onChanged,
  });
  const error = rename.error ?? remove.error ?? move.error;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input label={`Módulo ${moduleIndex + 1}`} value={title} maxLength={COURSE_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={title.trim().length === 0 || title.trim() === courseModule.title} loading={rename.isPending} onClick={() => rename.mutate()}>
          Guardar nombre
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label="Subir módulo" disabled={moduleIndex === 0 || move.isPending} onClick={() => move.mutate(-1)}>
          <ArrowUp className="size-4" aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label="Bajar módulo" disabled={moduleIndex === course.modules.length - 1 || move.isPending} onClick={() => move.mutate(1)}>
          <ArrowDown className="size-4" aria-hidden="true" />
        </Button>
        <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Eliminar el módulo y sus lecciones?" loading={remove.isPending} onConfirm={() => remove.mutate()}>
          <Trash2 className="size-4" aria-hidden="true" /> Eliminar
        </ConfirmButton>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {courseErrorText(error, "No pudimos aplicar el cambio. Intenta de nuevo.")}
        </p>
      ) : null}

      {courseModule.lessons.length === 0 ? <p className="text-sm text-muted-foreground">Este módulo todavía no tiene lecciones.</p> : null}
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {courseModule.lessons.map((lesson, index) => (
          <LessonRow
            key={lesson.id}
            organizationId={organizationId}
            siteId={siteId}
            course={course}
            moduleIndex={moduleIndex}
            lesson={lesson}
            lessonIndex={index}
            onChanged={onChanged}
          />
        ))}
      </ul>

      {adding ? (
        <LessonForm
          submitLabel="Agregar lección"
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            const updated = await addLesson(organizationId, siteId, course.id, courseModule.id, input);
            onChanged(updated);
            setAdding(false);
          }}
        />
      ) : (
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
            Agregar lección
          </Button>
        </div>
      )}
    </li>
  );
}

function LessonRow({
  organizationId,
  siteId,
  course,
  moduleIndex,
  lesson,
  lessonIndex,
  onChanged,
}: {
  organizationId: string;
  siteId: string;
  course: CourseDetailResponse;
  moduleIndex: number;
  lesson: LessonResponse;
  lessonIndex: number;
  onChanged: (course: CourseDetailResponse) => void;
}): React.JSX.Element {
  const courseModule = course.modules[moduleIndex]!;
  const [editing, setEditing] = useState(false);
  const remove = useMutation({ mutationFn: () => removeLesson(organizationId, siteId, course.id, lesson.id), onSuccess: onChanged });
  const move = useMutation({
    mutationFn: (direction: -1 | 1) => {
      const ids = courseModule.lessons.map((item) => item.id);
      const target = lessonIndex + direction;
      [ids[lessonIndex], ids[target]] = [ids[target]!, ids[lessonIndex]!];
      return reorderLessons(organizationId, siteId, course.id, courseModule.id, ids);
    },
    onSuccess: onChanged,
  });
  const otherModules = course.modules.filter((item) => item.id !== courseModule.id);
  const toModule = useMutation({ mutationFn: (moduleId: string) => updateLesson(organizationId, siteId, course.id, lesson.id, { moduleId }), onSuccess: onChanged });
  const error = remove.error ?? move.error ?? toModule.error;

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{lessonIndex + 1}.</span>
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{lesson.title}</span>
        {lesson.kind === "VIDEO" ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Video className="size-3.5" aria-hidden="true" /> Video
          </span>
        ) : null}
        {lesson.durationMinutes ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden="true" /> {lesson.durationMinutes} min
          </span>
        ) : null}
        {lesson.freePreview ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <Eye className="size-3.5" aria-hidden="true" /> De muestra
          </span>
        ) : null}
        <Button type="button" variant="ghost" size="sm" aria-label="Subir lección" disabled={lessonIndex === 0 || move.isPending} onClick={() => move.mutate(-1)}>
          <ArrowUp className="size-4" aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label="Bajar lección" disabled={lessonIndex === courseModule.lessons.length - 1 || move.isPending} onClick={() => move.mutate(1)}>
          <ArrowDown className="size-4" aria-hidden="true" />
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing((value) => !value)}>
          {editing ? "Cerrar" : "Editar"}
        </Button>
        <ConfirmButton variant="ghost" size="sm" confirmLabel="¿Eliminar la lección?" loading={remove.isPending} onConfirm={() => remove.mutate()}>
          <Trash2 className="size-4" aria-hidden="true" /> Eliminar
        </ConfirmButton>
      </div>
      {otherModules.length > 0 && editing ? (
        <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
          Mover a otro módulo
          <select
            className={selectClass}
            value=""
            onChange={(event) => {
              if (event.target.value) toModule.mutate(event.target.value);
            }}
          >
            <option value="">Elegir…</option>
            {otherModules.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {courseErrorText(error, "No pudimos aplicar el cambio. Intenta de nuevo.")}
        </p>
      ) : null}
      {editing ? (
        <LessonForm
          lesson={lesson}
          submitLabel="Guardar lección"
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            const updated = await updateLesson(organizationId, siteId, course.id, lesson.id, input);
            onChanged(updated);
            setEditing(false);
          }}
        />
      ) : null}
    </li>
  );
}

/** Formulario de una lección, para crearla o editarla. El servidor valida y sanea; esto solo guía. */
function LessonForm({
  lesson,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  lesson?: LessonResponse;
  submitLabel: string;
  onSubmit: (input: LessonInput) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [kind, setKind] = useState<"TEXT" | "VIDEO">(lesson?.kind ?? "TEXT");
  const [body, setBody] = useState(lesson?.body ?? "");
  const [video, setVideo] = useState("");
  const [minutes, setMinutes] = useState(lesson?.durationMinutes ? String(lesson.durationMinutes) : "");
  const [freePreview, setFreePreview] = useState(lesson?.freePreview ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasVideo = lesson?.kind === "VIDEO" && lesson.video !== null;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (title.trim().length === 0) return setError("Ponle un título a la lección.");
    if (minutes.trim() !== "" && (!/^\d+$/.test(minutes.trim()) || Number(minutes) < 1 || Number(minutes) > 600)) return setError("La duración va en minutos, entre 1 y 600.");
    setError(null);
    setPending(true);
    try {
      await onSubmit({
        title: title.trim(),
        kind,
        ...(kind === "TEXT" ? { body } : {}),
        // Sin pegar un enlace nuevo se conserva el video actual.
        ...(kind === "VIDEO" && video.trim() !== "" ? { video: video.trim() } : {}),
        durationMinutes: minutes.trim() === "" ? null : Number(minutes),
        freePreview,
      });
    } catch (caught) {
      setError(courseErrorText(caught, "No pudimos guardar la lección. Revisa los datos e intenta de nuevo."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} aria-label={lesson ? `Editar lección ${lesson.title}` : "Nueva lección"} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
      <Input label="Título de la lección" value={title} maxLength={COURSE_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} required />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-foreground">
          Tipo
          <select value={kind} onChange={(event) => setKind(event.target.value as "TEXT" | "VIDEO")} className={selectClass}>
            <option value="TEXT">Texto</option>
            <option value="VIDEO">Video (YouTube, Vimeo o TikTok)</option>
          </select>
        </label>
        <Input label="Duración (minutos)" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
      </div>
      {kind === "TEXT" ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Contenido</span>
          <RichTextEditor value={body} onChange={setBody} ariaLabel="Contenido de la lección" />
        </div>
      ) : (
        <Input
          label="Enlace del video"
          value={video}
          onChange={(event) => setVideo(event.target.value)}
          placeholder={hasVideo ? "Deja vacío para conservar el video actual" : "https://www.youtube.com/watch?v=…"}
        />
      )}
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={freePreview} onChange={(event) => setFreePreview(event.target.checked)} />
        Lección de muestra: la puede ver cualquiera
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
