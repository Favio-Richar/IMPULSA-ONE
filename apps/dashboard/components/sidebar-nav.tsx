"use client";

import { cn } from "@impulza/ui";
import { Building2, CalendarCheck, ChartColumn, ClipboardCheck, Gauge, Globe, Home, ImageIcon, LifeBuoy, Link2, ListOrdered, Megaphone, Package, Palette, Settings, ShieldCheck, ShoppingBag, Users, Wallet, Webhook, Workflow } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Solo los módulos que ya existen de verdad (auth + organizations F1.4/F1.5, sitios F2.9,
// contactos F3.3, enlaces cortos y QR F3.5, analítica F3.7, plan y uso F4.3, soporte F4.5) — el resto de la navegación de PM §13 (Herramientas, Agenda...) llega con sus
// fases y se agrega aquí recién cuando haya algo real detrás. "El menú mostrará solo módulos
// habilitados."
const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/sitios", label: "Sitios", icon: Globe },
  // Cola de solicitudes de publicación (F9.6c, ADR-028 §3).
  { href: "/aprobaciones", label: "Aprobaciones", icon: ClipboardCheck },
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
  { href: "/configuracion", label: "Equipo", icon: Settings },
  // F9.6a: roles personalizados (ADR-028 §3).
  { href: "/configuracion/roles", label: "Roles", icon: ShieldCheck },
];

/**
 * Lo que un negocio nunca delega a su agencia (ADR-028 §2): su cuenta de cobro, su suscripción y su equipo. El servidor
 * ya lo niega (`AGENCY_LIMIT`); esto evita ofrecer pantallas que siempre fallarían.
 */
const HIDDEN_WHEN_DELEGATED = new Set(["/cobros", "/plan", "/configuracion", "/configuracion/roles", "/configuracion/agencia"]);

/** A qué módulo acotable (F9.6b) pertenece cada pantalla del menú; lo que no está aquí no se acota. */
const MODULE_OF_HREF: Record<string, string> = {
  "/sitios": "sitios",
  "/aprobaciones": "sitios",
  "/contactos": "contactos",
  "/reservas": "reservas",
  "/catalogo": "catalogo",
  "/pedidos": "catalogo",
  "/campanas": "campanas",
  "/secuencias": "campanas",
  "/automatizaciones": "campanas",
  "/medios": "medios",
  "/analitica": "analitica",
  "/enlaces": "enlaces",
  "/soporte": "soporte",
  "/configuracion/marca": "marca",
};

export function SidebarNav({
  onNavigate,
  kind,
  delegated = false,
  allowedModules = [],
}: {
  onNavigate?: () => void;
  /** Tipo de la organización activa: una agencia administra clientes en `/agencia`; un negocio ve su agencia en Configuración. */
  kind?: "BUSINESS" | "AGENCY";
  /** Se está dentro del negocio de un cliente a través de una agencia. */
  delegated?: boolean;
  /** Módulos que la agencia le dejó a esta persona en este cliente; vacío = todos (F9.6b). El servidor igual lo niega. */
  allowedModules?: string[];
}): React.JSX.Element {
  const pathname = usePathname();
  const items = [
    ...NAV_ITEMS,
    kind === "AGENCY"
      ? { href: "/agencia", label: "Agencia", icon: Building2 }
      : { href: "/configuracion/agencia", label: "Agencia", icon: Building2 },
  ]
    .filter((item) => !(delegated && HIDDEN_WHEN_DELEGATED.has(item.href)))
    .filter((item) => {
      const moduleKey = MODULE_OF_HREF[item.href];
      return !(delegated && moduleKey !== undefined && allowedModules.length > 0 && !allowedModules.includes(moduleKey));
    });

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Navegación principal">
      {items.map((item) => {
        // "/" solo coincide exacto (si no, "Inicio" quedaría activo en cualquier ruta); el resto
        // usa prefijo para que una ruta anidada (p. ej. /sitios/:siteId) siga marcando su sección.
        // `/configuracion` no debe quedar activo dentro de `/configuracion/marca` ni `/configuracion/agencia`.
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : item.href === "/configuracion"
              ? pathname === "/configuracion"
              : pathname.startsWith(item.href);
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
