import Link from "next/link";
import { getPlatformBranding } from "../../lib/api";

/** Servidor: si no recibe la marca, la pide (F9.1) — así todas las páginas comerciales usan la misma. */
export async function MarketingFooter({
  bienvenidaHref,
  loginHref,
  branding,
}: {
  bienvenidaHref: string;
  loginHref: string;
  branding?: {
    name: string;
    logoLightUrl?: string | null;
    primaryColor?: string;
    footerText?: string | null;
    termsUrl?: string | null;
    privacyUrl?: string | null;
    supportUrl?: string | null;
  };
}) {
  const resolved = branding ?? (await getPlatformBranding());
  const name = resolved.name || "Impulza One";
  const primaryColor = resolved.primaryColor || "#0f6f6b";
  const initials = name.slice(0, 2).toUpperCase();
  const footerText =
    resolved.footerText ||
    "Portal biográfico, reservas, catálogo, mini-CRM, formularios, QR y analítica en un solo sistema.";

  return (
    <footer className="border-t border-[#e2e8f0] py-14">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2 text-base font-semibold text-[#0f172a]">
            {resolved.logoLightUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolved.logoLightUrl} alt={name} className="h-7 w-auto object-contain" />
            ) : (
              <span
                className="flex h-7 w-7 items-center justify-center rounded-[8px] text-xs font-bold text-white"
                style={{ backgroundColor: primaryColor }}
              >
                {initials}
              </span>
            )}
            {name}
          </span>
          <p className="max-w-xs text-sm text-[#64748b]">{footerText}</p>
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
          <Link href={resolved.termsUrl || "/terminos"} className="text-[#64748b] hover:text-[#0f172a]">
            Términos del servicio
          </Link>
          <Link href={resolved.privacyUrl || "/privacidad"} className="text-[#64748b] hover:text-[#0f172a]">
            Política de privacidad
          </Link>
          {resolved.supportUrl ? (
            <Link href={resolved.supportUrl} className="text-[#64748b] hover:text-[#0f172a]">
              Soporte
            </Link>
          ) : null}
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
        <span>© {new Date().getFullYear()} {name}.</span>
      </div>
    </footer>
  );
}
