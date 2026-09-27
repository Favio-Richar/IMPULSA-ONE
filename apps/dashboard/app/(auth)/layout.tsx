import type { ReactNode } from "react";
import { listTemplates } from "../../lib/api/templates";
import { AuthMosaic } from "../../components/auth/auth-mosaic";

/**
 * Layout compartido de las pantallas de acceso (login, registro, verificación de correo):
 * columna del formulario a la izquierda (cada page.tsx sigue siendo dueña de su propio contenido)
 * y panel de marca a la derecha, con el mosaico de plantillas reales (AuthMosaic). El catálogo es
 * público (PL1: sin sesión ni organización, igual que el onboarding lo usa) — si la API no
 * responde, el panel igual se muestra sin el mosaico en vez de romper el acceso al sistema.
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
      <main className="flex items-center justify-center bg-background p-4 sm:p-8">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <div className="relative hidden bg-[#0f6f6b] md:block">
        <AuthMosaic templates={templates} />
      </div>
    </div>
  );
}
