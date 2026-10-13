"use client";

import { cn } from "@impulza/ui";
import type { LucideIcon } from "lucide-react";
import { Building2, CalendarCheck, ChartColumn, ClipboardCheck, FileBarChart, Gauge, Globe, Home, ImageIcon, LifeBuoy, Link2, ListOrdered, Megaphone, Package, Palette, ScrollText, Settings, ShieldAlert, ShieldCheck, ShoppingBag, Users, Wallet, Webhook, Workflow, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

// Solo los módulos que ya existen de verdad (auth + organizations F1.4/F1.5, sitios F2.9,
// contactos F3.3, enlaces cortos y QR F3.5, analítica F3.7, plan y uso F4.3, soporte F4.5) — el resto de la navegación de PM §13 (Herramientas, Agenda...) llega con sus
// fases y se agrega aquí recién cuando haya algo real detrás. "El menú mostrará solo módulos
// habilitados."
/** Orden en que se muestran las secciones; dentro de cada una, el de `NAV_ITEMS`. */
const SECTIONS = ["General", "Clientes", "Marketing", "Analítica", "Sistema"] as const;
type NavSection = (typeof SECTIONS)[number];
type NavItem = { href: string; label: string; icon: LucideIcon; section: NavSection };

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", icon: Home, section: "General" },
  { href: "/sitios", label: "Sitios", icon: Globe, section: "General" },
  // Cola de solicitudes de publicación (F9.6c, ADR-028 §3).
  { href: "/aprobaciones", label: "Aprobaciones", icon: ClipboardCheck, section: "General" },
  { href: "/analitica", label: "Analítica", icon: ChartColumn, section: "Analítica" },
  // Informe por cliente con comparación de periodos (F9.8, ADR-028 §6).
  { href: "/reportes", label: "Reportes", icon: FileBarChart, section: "Analítica" },
  { href: "/contactos", label: "Contactos", icon: Users, section: "Clientes" },
  // Campañas de email (F5.6).
  { href: "/campanas", label: "Campañas", icon: Megaphone, section: "Marketing" },
  // Secuencias de correo automáticas (F7.5, ADR-020).
  { href: "/secuencias", label: "Secuencias", icon: ListOrdered, section: "Marketing" },
  // Automatizaciones básicas (F6.7).
  { href: "/automatizaciones", label: "Automatizaciones", icon: Workflow, section: "Marketing" },
  // Webhooks salientes hacia Zapier, Make u otros sistemas (F7.2, ADR-017).
  { href: "/integraciones", label: "Integraciones", icon: Webhook, section: "Sistema" },
  // Marketplace de integraciones y plantillas de socios (F10.6, ADR-029).
  { href: "/marketplace", label: "Marketplace", icon: Store, section: "Sistema" },
  // Agenda de reservas (F5.3).
  { href: "/reservas", label: "Reservas", icon: CalendarCheck, section: "Clientes" },
  { href: "/catalogo", label: "Catálogo", icon: Package, section: "Clientes" },
  { href: "/pedidos", label: "Pedidos", icon: ShoppingBag, section: "Clientes" },
  // Cuenta de Mercado Pago del negocio para cobrar a sus clientes (F5.8, ADR-013).
  { href: "/cobros", label: "Cobros", icon: Wallet, section: "Clientes" },
  { href: "/enlaces", label: "Enlaces y QR", icon: Link2, section: "Marketing" },
  { href: "/medios", label: "Medios", icon: ImageIcon, section: "Sistema" },
  { href: "/plan", label: "Plan y pagos", icon: Gauge, section: "Sistema" },
  { href: "/soporte", label: "Soporte", icon: LifeBuoy, section: "Sistema" },
  // F9.2: Marca de la organización (ADR-028 §4 nivel 2)
  { href: "/configuracion/marca", label: "Marca", icon: Palette, section: "Sistema" },
  { href: "/configuracion", label: "Equipo", icon: Settings, section: "Sistema" },
  // F9.6a: roles personalizados (ADR-028 §3).
  { href: "/configuracion/roles", label: "Roles", icon: ShieldCheck, section: "Sistema" },
  // F9.6d: auditoría navegable (ADR-028 s3). Solo propietario y administradores; el servidor lo comprueba.
  { href: "/configuracion/auditoria", label: "Auditoría", icon: ScrollText, section: "Sistema" },
  // F9.9: medidas de moderación y apelación (ADR-028 s7). Propietario y administradores; el servidor lo comprueba.
  { href: "/configuracion/moderacion", label: "Moderación", icon: ShieldAlert, section: "Sistema" },
];

/**
 * Lo que un negocio nunca delega a su agencia (ADR-028 §2): su cuenta de cobro, su suscripción y su equipo. El servidor
 * ya lo niega (`AGENCY_LIMIT`); esto evita ofrecer pantallas que siempre fallarían.
 */
const HIDDEN_WHEN_DELEGATED = new Set(["/cobros", "/plan", "/configuracion", "/configuracion/roles", "/configuracion/auditoria", "/configuracion/moderacion", "/configuracion/agencia"]);

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
  "/reportes": "analitica",
  "/enlaces": "enlaces",
  "/soporte": "soporte",
  "/configuracion/marca": "marca",
};

export function SidebarNav({
  onNavigate,
  kind,
  delegated = false,
  allowedModules = [],
  clientViewer = false,
  collapsed = false,
}: {
  onNavigate?: () => void;
  /** Tipo de la organización activa: una agencia administra clientes en `/agencia`; un negocio ve su agencia en Configuración. */
  kind?: "BUSINESS" | "AGENCY";
  /** Se está dentro del negocio de un cliente a través de una agencia. */
  delegated?: boolean;
  /** Módulos que la agencia le dejó a esta persona en este cliente; vacío = todos (F9.6b). El servidor igual lo niega. */
  allowedModules?: string[];
  /** Visor del portal del cliente (F9.7e): solo ve lo que el servidor le deja usar (Aprobaciones). */
  clientViewer?: boolean;
  /** Solo íconos (escritorio): el nombre sigue disponible para lectores de pantalla y en un tooltip. */
  collapsed?: boolean;
}): React.JSX.Element {
  const pathname = usePathname();
  // Tooltip del menú plegado: `position: fixed` porque la zona del menú tiene su propio scroll y recortaría uno absoluto.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const agencyItem: NavItem =
    kind === "AGENCY"
      ? { href: "/agencia", label: "Agencia", icon: Building2, section: "Sistema" }
      : { href: "/configuracion/agencia", label: "Agencia", icon: Building2, section: "Sistema" };
  const items = [...NAV_ITEMS, agencyItem]
    .filter((item) => !clientViewer || item.href === "/aprobaciones" || item.href === "/reportes")
    .filter((item) => !(delegated && HIDDEN_WHEN_DELEGATED.has(item.href)))
    .filter((item) => {
      const moduleKey = MODULE_OF_HREF[item.href];
      return !(delegated && moduleKey !== undefined && allowedModules.length > 0 && !allowedModules.includes(moduleKey));
    });
  // Una sección sin ningún ítem permitido no se dibuja (ni su encabezado).
  const groups = SECTIONS.map((section) => ({ section, items: items.filter((item) => item.section === section) })).filter(
    (group) => group.items.length > 0,
  );

  function showTip(label: string, element: HTMLElement): void {
    if (!collapsed) return;
    const rect = element.getBoundingClientRect();
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 8 });
  }

  return (
    <nav className={cn("flex flex-col gap-4 p-3", collapsed && "items-center px-2")} aria-label="Navegación principal">
      {groups.map((group) => {
        const headingId = `nav-section-${group.section}`;
        return (
          <div key={group.section} role="group" aria-labelledby={headingId} className={cn("flex flex-col gap-1", collapsed && "items-center")}>
            {collapsed ? (
              <span id={headingId} className="sr-only">
                {group.section}
              </span>
            ) : (
              <p id={headingId} className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.section}
              </p>
            )}
            {group.items.map((item) => {
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
                  onMouseEnter={(event) => showTip(item.label, event.currentTarget)}
                  onFocus={(event) => showTip(item.label, event.currentTarget)}
                  onMouseLeave={() => setTip(null)}
                  onBlur={() => setTip(null)}
                  className={cn(
                    "flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
                    collapsed ? "size-10 justify-center" : "px-3 py-2",
                    isActive ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-surface",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
      {collapsed && tip ? (
        <div
          role="tooltip"
          style={{ top: tip.top, left: tip.left }}
          className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md"
        >
          {tip.label}
        </div>
      ) : null}
    </nav>
  );
}
