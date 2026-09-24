"use client";

import { cn } from "@impulza/ui";
import { ChartColumn, Globe, Home, Link2, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Solo los módulos que ya existen de verdad (auth + organizations F1.4/F1.5, sitios F2.9,
// contactos F3.3, enlaces cortos y QR F3.5, analítica F3.7) — el resto de la navegación de PM §13 (Herramientas, Agenda...) llega con sus
// fases y se agrega aquí recién cuando haya algo real detrás. "El menú mostrará solo módulos
// habilitados."
const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/sitios", label: "Sitios", icon: Globe },
  { href: "/analitica", label: "Analítica", icon: ChartColumn },
  { href: "/contactos", label: "Contactos", icon: Users },
  { href: "/enlaces", label: "Enlaces y QR", icon: Link2 },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Navegación principal">
      {NAV_ITEMS.map((item) => {
        // "/" solo coincide exacto (si no, "Inicio" quedaría activo en cualquier ruta); el resto
        // usa prefijo para que una ruta anidada (p. ej. /sitios/:siteId) siga marcando su sección.
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-surface",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
