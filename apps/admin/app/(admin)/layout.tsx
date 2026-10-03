"use client";

import { Button, ErrorState, LoadingState } from "@impulza/ui";
import { brandCssVariables, DEFAULT_PLATFORM_BRANDING } from "@impulza/validation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, ShieldCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminNav } from "../../components/admin-nav";
import { ApiError } from "../../lib/api-client";
import { adminApi } from "../../lib/api";

/** Marca de la plataforma (F9.1): la administración también muestra el nombre y el logo configurados. */
function usePlatformBrand() {
  const query = useQuery({ queryKey: ["admin", "platform-branding"], queryFn: adminApi.getPlatformBranding });
  return {
    name: query.data?.name ?? DEFAULT_PLATFORM_BRANDING.name,
    logoUrl: query.data?.logoLightUrl ?? null,
    css: query.data ? brandCssVariables(query.data.primaryColor, query.data.secondaryColor) : null,
  };
}

function Brand(): React.JSX.Element {
  const brand = usePlatformBrand();
  return (
    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt={brand.name} className="h-6 max-w-[120px] object-contain" />
      ) : (
        <span className="flex size-7 items-center justify-center rounded-sm bg-foreground text-background">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </span>
      )}
      {brand.logoUrl ? "Administración" : `${brand.name} · Administración`}
    </span>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const meQuery = useQuery({ queryKey: ["admin", "me"], queryFn: adminApi.me });
  const brand = usePlatformBrand();

  const unauthenticated = meQuery.error instanceof ApiError && meQuery.error.status === 401;
  useEffect(() => {
    if (unauthenticated) {
      router.replace("/ingresar");
    }
  }, [unauthenticated, router]);

  if (unauthenticated) {
    return null;
  }

  if (meQuery.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <ErrorState title="No pudimos conectar con el servidor" description="Revisa tu conexión e intenta de nuevo." onRetry={() => meQuery.refetch()} />
      </main>
    );
  }

  if (meQuery.isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState label="Verificando tu sesión…" />
      </main>
    );
  }

  async function handleLogout(): Promise<void> {
    try {
      await adminApi.logout();
    } finally {
      queryClient.clear();
      router.replace("/ingresar");
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {brand.css ? <style>{brand.css}</style> : null}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-background md:block">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Brand />
        </div>
        <AdminNav />
      </aside>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-black/30" onClick={() => setMobileNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-background shadow-md">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <Brand />
              <Button variant="ghost" size="sm" onClick={() => setMobileNavOpen(false)} aria-label="Cerrar menú">
                <X className="size-4" />
              </Button>
            </div>
            <AdminNav onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      ) : null}

      {/* `min-w-0`: sin esto una tabla ancha empuja toda la página de lado en un teléfono. */}
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
          <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Abrir menú">
            <Menu className="size-4" />
          </Button>
          <p className="hidden text-sm text-muted-foreground md:block">Plataforma {brand.name} · acceso auditado</p>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden truncate text-sm text-muted-foreground sm:inline">{meQuery.data.email}</span>
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              Cerrar sesión
            </Button>
          </div>
        </header>
        <main className="flex-1 bg-surface/40 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
