"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Marca o desmarca una lección como completada (F10.3). El servidor decide si hay acceso; esto solo pide el cambio. */
export function LessonProgressButton({
  siteSlug,
  courseSlug,
  lessonId,
  completed,
  nextHref,
}: {
  siteSlug: string;
  courseSlug: string;
  lessonId: string;
  completed: boolean;
  /** A dónde seguir al completarla (la lección siguiente, o el temario si era la última). */
  nextHref: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/courses/progress/${encodeURIComponent(siteSlug)}/${encodeURIComponent(courseSlug)}/${encodeURIComponent(lessonId)}`,
        { method: completed ? "DELETE" : "PUT", headers: { "X-Requested-With": "impulza-one" } },
      );
      if (!response.ok) {
        setError(response.status === 401 || response.status === 403 ? "Tu acceso ya no está vigente. Vuelve a entrar con tu enlace." : "No pudimos guardar tu avance. Intenta de nuevo.");
        return;
      }
      if (completed) router.refresh();
      else router.push(nextHref);
    } catch {
      setError("No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-[var(--site-radius)] bg-[var(--site-color-primary)] px-5 text-sm font-semibold text-[var(--site-color-primary-foreground)] disabled:opacity-60"
      >
        {pending ? "Guardando…" : completed ? "Marcar como pendiente" : "Marcar como completada y seguir"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-[var(--site-color-foreground)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
