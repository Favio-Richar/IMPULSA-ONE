import Link from "next/link";

export function MarketingFooter({ bienvenidaHref, loginHref }: { bienvenidaHref: string; loginHref: string }) {
  return (
    <footer className="border-t border-[#e2e8f0] py-14">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2 text-base font-semibold text-[#0f172a]">
            <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[#0f6f6b] text-xs font-bold text-white">
              IO
            </span>
            Impulza One
          </span>
          <p className="max-w-xs text-sm text-[#64748b]">
            Portal biográfico, reservas, catálogo, mini-CRM, formularios, QR y analítica en un solo sistema.
          </p>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <span className="font-semibold text-[#0f172a]">Producto</span>
          <Link href="/producto" className="text-[#64748b] hover:text-[#0f172a]">
            Funcionalidades
          </Link>
          <Link href="/soluciones" className="text-[#64748b] hover:text-[#0f172a]">
            Soluciones por rubro
          </Link>
          <Link href="/integraciones" className="text-[#64748b] hover:text-[#0f172a]">
            Integraciones
          </Link>
          <Link href="/plantillas" className="text-[#64748b] hover:text-[#0f172a]">
            Plantillas
          </Link>
          <Link href="/planes" className="text-[#64748b] hover:text-[#0f172a]">
            Planes
          </Link>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <span className="font-semibold text-[#0f172a]">Recursos y Legal</span>
          <Link href="/recursos" className="text-[#64748b] hover:text-[#0f172a]">
            Recursos y Guías
          </Link>
          <Link href="/planes#faq" className="text-[#64748b] hover:text-[#0f172a]">
            Preguntas frecuentes
          </Link>
          <Link href="/terminos" className="text-[#64748b] hover:text-[#0f172a]">
            Términos del servicio
          </Link>
          <Link href="/privacidad" className="text-[#64748b] hover:text-[#0f172a]">
            Política de privacidad
          </Link>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <span className="font-semibold text-[#0f172a]">Cuenta</span>
          <a href={bienvenidaHref} className="text-[#64748b] hover:text-[#0f172a]">
            Crear mi portal gratis
          </a>
          <a href={loginHref} className="text-[#64748b] hover:text-[#0f172a]">
            Iniciar sesión
          </a>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-6xl border-t border-[#e2e8f0] px-4 pt-6 text-sm text-[#94a3b8] sm:px-6">
        <span>© {new Date().getFullYear()} Impulza One.</span>
      </div>
    </footer>
  );
}
