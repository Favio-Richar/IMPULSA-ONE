"use client";

import Link from "next/link";
import { useState } from "react";

const NAV_LINKS = [
  { href: "/producto", label: "Producto" },
  { href: "/soluciones", label: "Soluciones" },
  { href: "/integraciones", label: "Integraciones" },
  { href: "/recursos", label: "Recursos" },
  { href: "/plantillas", label: "Plantillas" },
  { href: "/planes", label: "Planes" },
];

export function MarketingHeader({
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
  };
}) {
  const [open, setOpen] = useState(false);
  const name = branding?.name || "Impulza One";
  const primaryColor = branding?.primaryColor || "#0f6f6b";
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-50 border-b border-[#e2e8f0] bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-[#0f172a]">
          {branding?.logoLightUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoLightUrl} alt={name} className="h-8 w-auto object-contain" />
          ) : (
            <span
              className="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm font-bold text-white"
              style={{ backgroundColor: primaryColor }}
            >
              {initials}
            </span>
          )}
          {name}
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm font-medium text-[#475569] hover:text-[#0f172a]">
              {link.label}
            </Link>
          ))}
          <Link href="/planes#faq" className="text-sm font-medium text-[#475569] hover:text-[#0f172a]">
            FAQ
          </Link>
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a href={loginHref} className="text-sm font-medium text-[#475569] hover:text-[#0f172a]">
            Iniciar sesión
          </a>
          <a
            href={bienvenidaHref}
            className="rounded-[10px] bg-[#0f6f6b] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Crear mi portal gratis
          </a>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="menu-movil"
          className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[#e2e8f0] text-[#0f172a] md:hidden"
        >
          <span className="sr-only">{open ? "Cerrar menú" : "Abrir menú"}</span>
          {open ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>

      {open ? (
        <div id="menu-movil" className="border-t border-[#e2e8f0] bg-white px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-3">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="text-sm font-medium text-[#475569]">
                {link.label}
              </Link>
            ))}
            <Link href="/planes#faq" onClick={() => setOpen(false)} className="text-sm font-medium text-[#475569]">
              FAQ
            </Link>
            <a href={loginHref} className="text-sm font-medium text-[#475569]">
              Iniciar sesión
            </a>
            <a
              href={bienvenidaHref}
              className="rounded-[10px] bg-[#0f6f6b] px-4 py-2.5 text-center text-sm font-semibold text-white"
            >
              Crear mi portal gratis
            </a>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
