import type { PageHeaderBlockConfig } from "@impulza/validation";

/** Encabezado de una página interna (F10): rótulo, título grande y bajada. Es el `h1` de la página. */
export function PageHeaderBlock({ config }: { config: PageHeaderBlockConfig }) {
  return (
    <header className="flex flex-col items-center gap-3 pb-2 pt-4 text-center">
      {config.eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--site-color-muted-foreground)]">{config.eyebrow}</p>
      ) : null}
      <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight text-[var(--site-color-foreground)] sm:text-5xl" style={{ fontFamily: "var(--site-font-heading)" }}>
        {config.title}
      </h1>
      {config.subtitle ? <p className="max-w-prose text-pretty text-base text-[var(--site-color-muted-foreground)]">{config.subtitle}</p> : null}
      <span aria-hidden="true" className="mt-2 h-px w-16 bg-[var(--site-color-primary)]" />
    </header>
  );
}
