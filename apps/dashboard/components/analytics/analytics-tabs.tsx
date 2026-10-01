"use client";

import { cn } from "@impulza/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/analitica", label: "Resumen" },
  { href: "/analitica/embudos", label: "Embudos" },
] as const;

/** Pestañas de la sección Analítica (F3.7 resumen, F7.6 embudos). Enlaces reales: cada vista tiene su URL. */
export function AnalyticsTabs(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones de analítica" className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
