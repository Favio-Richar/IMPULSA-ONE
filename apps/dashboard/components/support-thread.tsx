import type { SupportMessageResponse, SupportTicketStatus } from "@impulza/contracts";
import { cn } from "@impulza/ui";
import { Headset, UserRound } from "lucide-react";

const dateTime = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });

export function formatSupportDate(iso: string): string {
  return dateTime.format(new Date(iso));
}

const STATUS: Record<SupportTicketStatus, { label: string; className: string; dot: string }> = {
  OPEN: { label: "Esperando respuesta", className: "border-warning/30 bg-warning/5 text-warning", dot: "bg-warning" },
  ANSWERED: { label: "Respondida", className: "border-primary/30 bg-primary/5 text-primary", dot: "bg-primary" },
  CLOSED: { label: "Cerrada", className: "border-border bg-surface text-muted-foreground", dot: "bg-muted-foreground" },
};

/** Estado de una solicitud, con texto además de color (WCAG). */
export function SupportStatusBadge({ status }: { status: SupportTicketStatus }): React.JSX.Element {
  const style = STATUS[status];
  return (
    <span className={cn("inline-flex w-fit shrink-0 items-center gap-1.5 self-start rounded-sm border px-2 py-0.5 text-xs font-medium sm:self-auto", style.className)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden="true" />
      {style.label}
    </span>
  );
}

/**
 * Conversación de una solicitud. El texto se muestra tal cual, como texto (React escapa): nunca
 * se interpreta como HTML. Los mensajes del equipo van firmados por el equipo, sin su correo.
 */
export function SupportThread({ messages }: { messages: SupportMessageResponse[] }): React.JSX.Element {
  return (
    <ol className="flex flex-col gap-4" aria-label="Conversación">
      {messages.map((message) => {
        const isStaff = message.authorRole === "STAFF";
        const Icon = isStaff ? Headset : UserRound;
        return (
          <li
            key={message.id}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-4",
              isStaff ? "border-primary/25 bg-primary/5" : "border-border bg-background",
            )}
          >
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
                <span className="truncate">{isStaff ? "Equipo de Impulza One" : (message.authorEmail ?? "Cuenta eliminada")}</span>
              </span>
              <time dateTime={message.createdAt} className="text-xs text-muted-foreground">
                {formatSupportDate(message.createdAt)}
              </time>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{message.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
