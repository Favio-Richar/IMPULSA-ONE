"use client";

import { cn } from "@impulza/ui";
import { Building2, CreditCard, LayoutDashboard, LifeBuoy, ScrollText, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/organizaciones", label: "Organizaciones", icon: Building2 },
  { href: "/usuarios", label: "Usuarios", icon: Users },
  { href: "/soporte", label: "Soporte", icon: LifeBuoy },
  { href: "/planes", label: "Planes", icon: CreditCard },
  { href: "/auditoria", label: "Auditoría", icon: ScrollText },
];

export function AdminNav({ onNavigate }: { onNavigate?: () => void }): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Navegación de administración">
      {NAV_ITEMS.map((item) => {
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
              isActive ? "bg-foreground text-background" : "text-foreground hover:bg-surface",
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
