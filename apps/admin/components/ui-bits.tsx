import { Button, cn } from "@impulza/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatInteger } from "../lib/format";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Estado con texto además de color (WCAG: nunca solo color). */
export function StatusBadge({ status }: { status: "ACTIVE" | "BLOCKED" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium",
        status === "BLOCKED" ? "border-danger/30 bg-danger/5 text-danger" : "border-success/30 bg-success/5 text-success",
      )}
    >
      <span className={cn("size-1.5 rounded-full", status === "BLOCKED" ? "bg-danger" : "bg-success")} aria-hidden="true" />
      {status === "BLOCKED" ? "Bloqueada" : "Activa"}
    </span>
  );
}

export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "primary" | "warning" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium",
        tone === "primary" && "border-primary/30 bg-primary/5 text-primary",
        tone === "warning" && "border-warning/30 bg-warning/5 text-warning",
        tone === "neutral" && "border-border bg-surface text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) {
    return null;
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <p aria-live="polite">
        {formatInteger(from)}–{formatInteger(to)} de {formatInteger(total)}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="size-4" aria-hidden="true" />
          Anterior
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Siguiente
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** Tarjeta de sección con título: la unidad de composición de las pantallas de administración. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-background p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id={id} className="text-base font-semibold text-foreground">
            {title}
          </h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
