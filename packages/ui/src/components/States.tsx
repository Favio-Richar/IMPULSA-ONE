import { AlertTriangle, Inbox, Loader2, type LucideIcon, WifiOff } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./Button.js";

// Estados obligatorios en toda UI (CLAUDE.md / PM §16): carga, vacío, error recuperable,
// desconectado. "Sin permisos" y "límite de plan" se resuelven a nivel de layout (F1.8), no aquí.

interface StateShellProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

function StateShell({ icon: Icon, title, description, action, className }: StateShellProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-10 text-center",
        className,
      )}
    >
      <Icon className="size-10 text-disabled-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <StateShell icon={Inbox} title={title} description={description} action={action} className={className} />
  );
}

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = "Cargando…", className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-center justify-center gap-3 p-10 text-center", className)}
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Algo salió mal",
  description = "Ocurrió un error inesperado. Intenta de nuevo.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <StateShell
      icon={AlertTriangle}
      title={title}
      description={description}
      className={className}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        ) : undefined
      }
    />
  );
}

export interface OfflineStateProps {
  onRetry?: () => void;
  className?: string;
}

export function OfflineState({ onRetry, className }: OfflineStateProps) {
  return (
    <StateShell
      icon={WifiOff}
      title="Sin conexión"
      description="Revisa tu conexión a internet e intenta de nuevo."
      className={className}
      action={
        onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        ) : undefined
      }
    />
  );
}
