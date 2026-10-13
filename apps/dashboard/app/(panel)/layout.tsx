"use client";

import { Button, ErrorState, ImpulzaLogo, LoadingState } from "@impulza/ui";
import { brandCssVariables } from "@impulza/validation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BlockedOrganizationBanner } from "../../components/blocked-organization-banner";
import { DelegatedAccessBanner } from "../../components/delegated-access-banner";
import { OrgSwitcher } from "../../components/org-switcher";
import { SidebarNav } from "../../components/sidebar-nav";
import { ApiError } from "../../lib/api-client";
import { logout } from "../../lib/api/auth";
import { listMyOrganizations } from "../../lib/api/organizations";
import { useActiveOrgStore } from "../../lib/active-org-store";
import { useMe } from "../../lib/hooks/use-me";
import { useNavCollapsed } from "../../lib/hooks/use-nav-collapsed";
import { usePlatformBranding } from "../../lib/hooks/use-platform-branding";
import { usePanelBrand } from "../../lib/hooks/use-white-label";

export default function PanelLayout({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Menú plegado a solo íconos en escritorio (preferencia de este navegador).
  const [navCollapsed, toggleNavCollapsed] = useNavCollapsed();

  const activeOrganizationId = useActiveOrgStore((state) => state.activeOrganizationId);
  const meQuery = useMe();
  const brandingQuery = usePlatformBranding();
  // F9.7a: si la organización activa es cliente de una agencia con marca blanca, el panel lleva la marca de la agencia.
  const panelBrandQuery = usePanelBrand(activeOrganizationId);
  const panelBrand = panelBrandQuery.data?.brand ?? null;
  const brandName = panelBrand?.displayName ?? brandingQuery.data?.name ?? "Impulza One";
  const brandLogo = panelBrand ? panelBrand.logoLightUrl : (brandingQuery.data?.logoLightUrl ?? null);
  // `brandCssVariables` valida cada color como hexadecimal: nada sin validar llega a un <style>.
  const brandCss = panelBrand ? brandCssVariables(panelBrand.primaryColor, panelBrand.secondaryColor) : null;
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
  const activeOrganization = orgsQuery.data?.find((org) => org.id === activeOrganizationId);
  const clientViewer = activeOrganization?.access?.clientViewer ?? false;
  // F9.7e: el visor del portal no tiene panel de gestión; su inicio es la cola de aprobaciones.
  const sendViewerHome = clientViewer && pathname === "/";

  async function handleLogout(): Promise<void> {
    await logout();
    queryClient.clear();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen bg-background" data-testid="panel-root" data-brand={panelBrand ? "white-label" : "platform"}>
      {brandCss ? <style>{brandCss}</style> : null}
      {/* Altura de la pantalla y pegado arriba: el scroll de la página no lo mueve. Tres zonas: cabecera con la marca
          (fija) y navegación (la única zona que se desplaza). El botón de plegar está en la cabecera de la página. */}
      <aside
        id="panel-sidebar"
        data-collapsed={navCollapsed ? "true" : "false"}
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 motion-reduce:transition-none md:flex print:hidden ${
          navCollapsed ? "w-16" : "w-56"
        }`}
      >
        <div
          className={`flex h-14 shrink-0 items-center border-b border-border text-sm font-semibold text-foreground ${
            navCollapsed ? "justify-center px-2" : "px-4"
          }`}
        >
          {brandLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandLogo} alt={brandName} className={navCollapsed ? "size-8 object-contain" : "h-6 max-w-[140px] object-contain"} />
          ) : panelBrand ? (
            // Marca blanca sin logo propio: nunca el de Impulza; el nombre de la agencia (o su inicial al plegar).
            navCollapsed ? (
              <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                {brandName.slice(0, 1).toUpperCase()}
              </span>
            ) : (
              brandName
            )
          ) : (
            // Valor de fábrica de la plataforma: nadie configuró un logo.
            <PlatformFallbackLogo name={brandName} collapsed={navCollapsed} />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <SidebarNav
            kind={activeOrganization?.kind}
            delegated={activeOrganization?.access?.delegated ?? false}
            allowedModules={activeOrganization?.access?.modules ?? []}
            clientViewer={clientViewer}
            collapsed={navCollapsed}
          />
        </div>
      </aside>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-background shadow-md">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="text-sm font-semibold text-foreground">
                {brandLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brandLogo} alt={brandName} className="h-6 max-w-[140px] object-contain" />
                ) : panelBrand ? (
                  brandName
                ) : (
                  <PlatformFallbackLogo name={brandName} collapsed={false} />
                )}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Cerrar menú"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <SidebarNav
                onNavigate={() => setMobileNavOpen(false)}
                kind={activeOrganization?.kind}
                delegated={activeOrganization?.access?.delegated ?? false}
                allowedModules={activeOrganization?.access?.modules ?? []}
                clientViewer={clientViewer}
              />
            </div>
          </aside>
        </div>
      ) : null}

      {/* `min-w-0`: sin esto el ítem flex crece al ancho de su contenido más ancho (una tabla) y
          toda la página se desplaza de lado en un teléfono, en vez de desplazarse solo la tabla. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4 print:hidden">
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu className="size-4" />
          </Button>
          {/* Escritorio: pliega el menú a solo íconos y lo vuelve a expandir. */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex"
            onClick={toggleNavCollapsed}
            aria-label={navCollapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
            aria-expanded={!navCollapsed}
            aria-controls="panel-sidebar"
          >
            <Menu className="size-4" aria-hidden="true" />
          </Button>

          {/* `min-w-0`: el selector se encoge en un teléfono en vez de empujar la cabecera fuera de la
              pantalla cuando el nombre de una organización es largo. */}
          <div className="min-w-0 flex-1">{orgsQuery.data ? <OrgSwitcher organizations={orgsQuery.data} /> : null}</div>

          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              Cerrar sesión
            </Button>
          </div>
        </header>

        {orgsQuery.data ? <BlockedOrganizationBanner organizations={orgsQuery.data} /> : null}
        {orgsQuery.data ? <DelegatedAccessBanner organizations={orgsQuery.data} /> : null}

        <main className="flex-1 p-4 md:p-6">
          {sendViewerHome ? <ViewerHomeRedirect /> : children}
        </main>

        {panelBrand?.footerText || panelBrand?.supportEmail ? (
          <footer className="border-t border-border px-4 py-3 text-xs text-muted-foreground print:hidden" data-testid="panel-brand-footer">
            {panelBrand.footerText}
            {panelBrand.footerText && panelBrand.supportEmail ? " · " : ""}
            {panelBrand.supportEmail ? <a href={`mailto:${panelBrand.supportEmail}`} className="underline underline-offset-2">{panelBrand.supportEmail}</a> : null}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** Lleva al visor del portal a su inicio (la cola de aprobaciones): el efecto evita navegar durante el render. */
function ViewerHomeRedirect(): null {
  const router = useRouter();
  useEffect(() => {
    router.replace("/aprobaciones");
  }, [router]);
  return null;
}

/**
 * Logo de fábrica del panel cuando nadie configuró uno: el logo oficial de Impulza One mientras la plataforma conserve
 * su nombre; si el superadministrador la renombró sin subir logo, el isotipo con ese nombre (no mostramos otra marca).
 */
function PlatformFallbackLogo({ name, collapsed }: { name: string; collapsed: boolean }): React.JSX.Element {
  if (name !== "Impulza One") {
    return <ImpulzaLogo variant={collapsed ? "icon" : "full"} name={name} />;
  }
  return collapsed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/impulza-logo-icon.png" alt={name} width={36} height={36} className="size-9 object-contain" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/impulza-logo.png" alt={name} width={720} height={210} className="h-10 w-auto max-w-[180px] object-contain object-left" />
  );
}
