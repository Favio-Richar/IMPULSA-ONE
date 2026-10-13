import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "../lib/cn.js";

export interface TabItem {
  /** Identificador estable (el que viaja en la URL, por ejemplo). */
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Nombre accesible de la lista de pestañas. */
  label: string;
  /** Contenido de la pestaña activa: solo se monta ese (las demás no consultan nada hasta que se abren). */
  children: ReactNode;
  className?: string;
}

/**
 * Pestañas accesibles (patrón WAI-ARIA «Tabs» con activación automática): `tablist` / `tab` / `tabpanel`, un solo `tab` en el orden
 * de tabulación (roving tabindex), flechas ← → y Home/End para moverse, y la pestaña activa vinculada a su panel con
 * `aria-controls` / `aria-labelledby`. Es controlado: quien lo usa decide dónde vive el valor (estado, URL…).
 *
 * En un teléfono la lista se desplaza en horizontal (sin romper el diseño) y la pestaña activa se mantiene a la vista.
 */
export function Tabs({ tabs, value, onValueChange, label, children, className }: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const tabId = (tab: string) => `${baseId}-tab-${tab}`;
  const panelId = `${baseId}-panel`;

  // La pestaña activa siempre a la vista cuando la lista se desplaza (teléfono, o al abrir con `?tab=`).
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const index = tabs.findIndex((tab) => tab.value === value);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === -1) return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onValueChange(target.value);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(target.value))}`)?.focus();
  }

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <div
          ref={listRef}
          role="tablist"
          aria-label={label}
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
          className="flex min-w-max gap-1 border-b border-border"
        >
          {tabs.map((tab) => {
            const selected = tab.value === value;
            return (
              <button
                key={tab.value}
                id={tabId(tab.value)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => onValueChange(tab.value)}
                className={cn(
                  "-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-0",
                  selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground",
                )}
              >
                {tab.icon ? <span aria-hidden="true">{tab.icon}</span> : null}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(value)} tabIndex={0} className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]">
        {children}
      </div>
    </div>
  );
}
