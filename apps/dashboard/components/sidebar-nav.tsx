"use client";

import { cn } from "@impulza/ui";
import { CalendarCheck, ChartColumn, Gauge, Globe, Home, ImageIcon, LifeBuoy, Link2, ListOrdered, Megaphone, Package, Palette, Settings, ShoppingBag, Users, Wallet, Webhook, Workflow } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Solo los módulos que ya existen de verdad (auth + organizations F1.4/F1.5, sitios F2.9,
// contactos F3.3, enlaces cortos y QR F3.5, analítica F3.7, plan y uso F4.3, soporte F4.5) — el resto de la navegación de PM §13 (Herramientas, Agenda...) llega con sus
// fases y se agrega aquí recién cuando haya algo real detrás. "El menú mostrará solo módulos
// habilitados."
const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/sitios", label: "Sitios", icon: Globe },
  { href: "/analitica", label: "Analítica", icon: ChartColumn },
  { href: "/contactos", label: "Contactos", icon: Users },
  // Campañas de email (F5.6).
  { href: "/campanas", label: "Campañas", icon: Megaphone },
  // Secuencias de correo automáticas (F7.5, ADR-020).
  { href: "/secuencias", label: "Secuencias", icon: ListOrdered },
  // Automatizaciones básicas (F6.7).
  { href: "/automatizaciones", label: "Automatizaciones", icon: Workflow },
  // Webhooks salientes hacia Zapier, Make u otros sistemas (F7.2, ADR-017).
  { href: "/integraciones", label: "Integraciones", icon: Webhook },
  // Agenda de reservas (F5.3).
  { href: "/reservas", label: "Reservas", icon: CalendarCheck },
  { href: "/catalogo", label: "Catálogo", icon: Package },
  { href: "/pedidos", label: "Pedidos", icon: ShoppingBag },
  // Cuenta de Mercado Pago del negocio para cobrar a sus clientes (F5.8, ADR-013).
  { href: "/cobros", label: "Cobros", icon: Wallet },
  { href: "/enlaces", label: "Enlaces y QR", icon: Link2 },
  { href: "/medios", label: "Medios", icon: ImageIcon },
  { href: "/plan", label: "Plan y pagos", icon: Gauge },
  { href: "/soporte", label: "Soporte", icon: LifeBuoy },
  // F9.2: Marca de la organización (ADR-028 §4 nivel 2)
  { href: "/configuracion/marca", label: "Marca", icon: Palette },
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
