"use client";

import { ErrorState, LoadingState } from "@impulza/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError } from "../../lib/api-client";
import { useMe } from "../../lib/hooks/use-me";
import { usePlatformBranding } from "../../lib/hooks/use-platform-branding";

/**
 * Marco del onboarding (PM §8.2): sin la barra lateral del panel, para que el usuario se concentre
 * en un paso a la vez. Exige sesión igual que el panel; la salida siempre está a la vista.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const router = useRouter();
  const meQuery = useMe();
  const brandingQuery = usePlatformBranding();
  const brandName = brandingQuery.data?.name ?? "Impulza One";

  if (meQuery.isError) {
    if (meQuery.error instanceof ApiError && meQuery.error.status === 401) {
      if (typeof window !== "undefined") {
        router.replace("/login");
      }
      return null;
    }
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

  if (meQuery.isPending || !meQuery.data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState label="Cargando…" />
      </main>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
        <span className="text-sm font-semibold text-foreground">
          {brandingQuery.data?.logoLightUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandingQuery.data.logoLightUrl} alt={brandName} className="h-6 max-w-[140px] object-contain" />
          ) : (
            brandName
          )}
        </span>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          Salir del asistente
        </Link>
      </header>
      <main className="flex-1 px-4 py-6 md:py-10">{children}</main>
    </div>
  );
}
