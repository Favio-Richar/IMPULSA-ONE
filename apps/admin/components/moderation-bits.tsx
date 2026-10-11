import type { AdminAbuseReportResponse } from "@impulza/contracts";
import { cn } from "@impulza/ui";

type Status = AdminAbuseReportResponse["status"];

export const MODERATION_STATUS_LABELS: Record<Status, string> = {
  OPEN: "Sin revisar",
  APPEALED: "Apelado",
  WARNED: "Advertido",
  SITE_UNPUBLISHED: "Sitio despublicado",
  ORG_SUSPENDED: "Organización suspendida",
  DISMISSED: "Descartado",
};

const STATUS_STYLE: Record<Status, { className: string; dot: string }> = {
  OPEN: { className: "border-warning/30 bg-warning/5 text-warning", dot: "bg-warning" },
  APPEALED: { className: "border-primary/30 bg-primary/5 text-primary", dot: "bg-primary" },
  WARNED: { className: "border-border bg-surface text-foreground", dot: "bg-foreground" },
  SITE_UNPUBLISHED: { className: "border-danger/30 bg-danger/5 text-danger", dot: "bg-danger" },
  ORG_SUSPENDED: { className: "border-danger/30 bg-danger/5 text-danger", dot: "bg-danger" },
  DISMISSED: { className: "border-border bg-surface text-muted-foreground", dot: "bg-muted-foreground" },
};

export function ModerationStatusBadge({ status }: { status: Status }): React.JSX.Element {
  const style = STATUS_STYLE[status];
  return (
    <span className={cn("inline-flex w-fit shrink-0 items-center gap-1.5 self-start rounded-sm border px-2 py-0.5 text-xs font-medium sm:self-auto", style.className)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden="true" />
      {MODERATION_STATUS_LABELS[status]}
    </span>
  );
}

/** Lo que se le explica al moderador antes de confirmar: qué cambia y qué NO cambia. */
export const MODERATION_ACTION_HELP: Record<string, string> = {
  dismiss: "No procede ninguna medida. El caso se cierra y el propietario no recibe aviso.",
  warn: "El sitio sigue publicado. El propietario recibe un correo con el motivo y cómo apelar.",
  unpublish: "El sitio deja de mostrarse al público (404). No se borra nada y es reversible. El propietario recibe un correo con el motivo y cómo apelar.",
  suspend: "Se bloquea toda la organización: sus páginas dejan de mostrarse y su panel queda en solo lectura. No se borra nada y es reversible. El propietario recibe un correo con el motivo y cómo apelar.",
  restore: "Se retira la medida de este caso (salvo que otro reporte vigente la siga necesitando) y el caso se cierra. El propietario recibe un aviso.",
  uphold: "La medida sigue vigente. Se le explica al propietario por qué y ya no podrá volver a apelar esta decisión.",
};

/** Acciones que afectan a terceros de forma visible: piden una segunda confirmación. */
export const MODERATION_CONFIRM_ACTIONS = new Set(["unpublish", "suspend"]);
