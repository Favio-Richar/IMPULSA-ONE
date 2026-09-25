import type { SupportMessageResponse, SupportTicketStatus } from "@impulza/contracts";
import { cn } from "@impulza/ui";
import { Headset, UserRound } from "lucide-react";
import { formatDateTime } from "../lib/format";

export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  OPEN: "Sin responder",
  ANSWERED: "Respondidas",
  CLOSED: "Cerradas",
};

const STATUS_STYLE: Record<SupportTicketStatus, { label: string; className: string; dot: string }> = {
  OPEN: { label: "Sin responder", className: "border-warning/30 bg-warning/5 text-warning", dot: "bg-warning" },
  ANSWERED: { label: "Esperando al cliente", className: "border-primary/30 bg-primary/5 text-primary", dot: "bg-primary" },
  CLOSED: { label: "Cerrada", className: "border-border bg-surface text-muted-foreground", dot: "bg-muted-foreground" },
};

export function SupportStatusBadge({ status }: { status: SupportTicketStatus }): React.JSX.Element {
  const style = STATUS_STYLE[status];
  return (
    <span className={cn("inline-flex w-fit shrink-0 items-center gap-1.5 self-start rounded-sm border px-2 py-0.5 text-xs font-medium sm:self-auto", style.className)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden="true" />
      {style.label}
    </span>
  );
}

/** Conversación vista por el equipo: acá sí se ve el correo de quien respondió del equipo. */
export function SupportThread({ messages }: { messages: SupportMessageResponse[] }): React.JSX.Element {
  return (
    <ol className="flex flex-col gap-4" aria-label="Conversación">
      {messages.map((message) => {
        const isStaff = message.authorRole === "STAFF";
        const Icon = isStaff ? Headset : UserRound;
        return (
          <li key={message.id} className={cn("flex flex-col gap-2 rounded-lg border p-4", isStaff ? "border-primary/25 bg-primary/5" : "border-border bg-background")}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full",
                    isStaff ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="truncate">{message.authorEmail ?? (isStaff ? "Equipo" : "Cuenta eliminada")}</span>
                <span className="shrink-0 text-xs font-normal text-muted-foreground">{isStaff ? "Equipo" : "Cliente"}</span>
              </span>
              <time dateTime={message.createdAt} className="text-xs text-muted-foreground">
                {formatDateTime(message.createdAt)}
              </time>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{message.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
