import type { LucideIcon } from "lucide-react";

/** Cifra suelta del dashboard (F3.7): etiqueta, valor y, si hace falta, una nota que explica cómo
 *  se mide. Sin color de dato en el texto: el valor va en tinta principal. */
export function StatTile({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note?: string;
  icon: LucideIcon;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
