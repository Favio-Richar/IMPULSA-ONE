"use client";

import { Button, ErrorState, LoadingState } from "@impulza/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BlockedOrganizationBanner } from "../../components/blocked-organization-banner";
import { OrgSwitcher } from "../../components/org-switcher";
import { SidebarNav } from "../../components/sidebar-nav";
import { ApiError } from "../../lib/api-client";
import { logout } from "../../lib/api/auth";
import { listMyOrganizations } from "../../lib/api/organizations";
import { useMe } from "../../lib/hooks/use-me";

export default function PanelLayout({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const meQuery = useMe();
  const orgsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listMyOrganizations,
    enabled: meQuery.isSuccess,
  });

  // Estado: desconectado — sesión inválida/expirada. Redirige en vez de mostrar un panel roto.
  if (meQuery.isError) {
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401) {
      if (typeof window !== "undefined") {
        router.replace("/login");
      }
      return null;
    }

    // Estado: error recuperable (red caída, API abajo, etc.)
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <ErrorState
          title="No pudimos conectar con el servidor"
          description="Revisa tu conexión e intenta de nuevo."
          onRetry={() => meQuery.refetch()}
        />
      </main>
    );
  }

  // Estado: carga
  if (meQuery.isPending || !meQuery.data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState label="Cargando tu panel…" />
      </main>
    );
  }

  const user = meQuery.data;

  async function handleLogout(): Promise<void> {
    await logout();
    queryClient.clear();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-56 shrink-0 border-r border-border md:block">
        <div className="flex h-14 items-center border-b border-border px-4 text-sm font-semibold text-foreground">
          Impulza One
        </div>
        <SidebarNav />
      </aside>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-64 bg-background shadow-md">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <span className="text-sm font-semibold text-foreground">Impulza One</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Cerrar menú"
              >
                <X className="size-4" />
              </Button>
            </div>
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      ) : null}

      {/* `min-w-0`: sin esto el ítem flex crece al ancho de su contenido más ancho (una tabla) y
          toda la página se desplaza de lado en un teléfono, en vez de desplazarse solo la tabla. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu className="size-4" />
          </Button>

          <div className="flex-1">{orgsQuery.data ? <OrgSwitcher organizations={orgsQuery.data} /> : null}</div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              Cerrar sesión
            </Button>
          </div>
        </header>

        {orgsQuery.data ? <BlockedOrganizationBanner organizations={orgsQuery.data} /> : null}

        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
