import type { ReactNode } from "react";
import { listTemplates } from "../../lib/api/templates";
import { AuthMosaic } from "../../components/auth/auth-mosaic";
import { env } from "../../lib/env";

/**
 * Layout compartido de las pantallas de acceso (login, registro, verificación de correo):
 * columna del formulario a la izquierda (cada page.tsx sigue siendo dueña de su propio contenido)
 * y panel de marca a la derecha, con el mosaico de plantillas reales (AuthMosaic). El catálogo es
 * público (PL1: sin sesión ni organización, igual que el onboarding lo usa) — si la API no
 * responde, el panel igual se muestra sin el mosaico en vez de romper el acceso al sistema.
 *
 * El enlace "Volver a Impulza One" (y el logo del panel derecho) apuntan a NEXT_PUBLIC_WEB_BASE_URL
 * -- el sitio de marketing (apps/web), un proceso/origen distinto al panel -- igual que Linktree,
 * Beacons, etc. dejan volver a su landing desde el login.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  let templates: Awaited<ReturnType<typeof listTemplates>> = [];
  try {
    templates = await listTemplates();
  } catch {
    templates = [];
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <main className="relative flex items-center justify-center bg-background p-4 sm:p-8">
        <a
          href={env.NEXT_PUBLIC_WEB_BASE_URL}
          className="absolute left-4 top-4 flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:left-8 sm:top-8"
        >
          <span aria-hidden="true">←</span>
          Volver a Impulza One
        </a>
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <div className="relative hidden bg-[#0f6f6b] md:block">
        <AuthMosaic templates={templates} webBaseUrl={env.NEXT_PUBLIC_WEB_BASE_URL} />
      </div>
    </div>
  );
}
