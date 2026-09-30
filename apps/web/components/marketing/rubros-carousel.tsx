"use client";

import { HeroCarousel, type HeroCarouselItem } from "@/components/ui/hero-carousel";
import { PHOTOS, unsplash } from "@/lib/marketing-images";

// Portada de /plantillas: un rubro por diapositiva, cada uno con su plantilla real del catálogo y
// solo funciones que ya existen en el producto (nada de promesas de fases futuras).
const RUBROS: HeroCarouselItem[] = [
  { id: "belleza-barberia", title: "Barberías\ny peluquerías", image: unsplash(PHOTOS.barberia.id, 1600), imageAlt: PHOTOS.barberia.alt, credit: "Plantilla Barbería", meta: ["Reservas", "Recordatorios", "WhatsApp"], accent: "#b45309" },
  { id: "cafe-gastronomia", title: "Cafés y\nrestaurantes", image: unsplash(PHOTOS.cafeLocal.id, 1600), imageAlt: PHOTOS.cafeLocal.alt, credit: "Plantilla Café", meta: ["Catálogo", "Pedidos", "Ubicación"], accent: "#c2410c" },
  { id: "comercio-tienda", title: "Tiendas y\nemprendimientos", image: unsplash(PHOTOS.tienda.id, 1600), imageAlt: PHOTOS.tienda.alt, credit: "Plantilla Tienda", meta: ["Catálogo", "Pedidos", "Stock"], accent: "#0f6f6b" },
  { id: "salud-bienestar", title: "Salud y\nbienestar", image: unsplash(PHOTOS.bienestar.id, 1600), imageAlt: PHOTOS.bienestar.alt, credit: "Plantilla Bienestar", meta: ["Agenda", "Formularios", "Mini-CRM"], accent: "#0e7490" },
  { id: "creador-personal", title: "Creadores y\nmarca personal", image: unsplash(PHOTOS.creadora.id, 1600), imageAlt: PHOTOS.creadora.alt, credit: "Plantilla Creador", meta: ["Enlaces", "QR", "Analítica"], accent: "#be185d" },
  { id: "eventos-turismo", title: "Eventos y\nturismo", image: unsplash(PHOTOS.concierto.id, 1600), imageAlt: PHOTOS.concierto.alt, credit: "Plantilla Eventos", meta: ["Campañas", "Enlaces cortos", "QR"], accent: "#7c3aed" },
  { id: "profesional-servicios", title: "Servicios\nprofesionales", image: unsplash(PHOTOS.consultoria.id, 1600), imageAlt: PHOTOS.consultoria.alt, credit: "Plantilla Servicios", meta: ["Agenda", "Formularios", "Campañas"], accent: "#1d4ed8" },
  { id: "portada-minimal", title: "Portafolios\ny creativos", image: unsplash(PHOTOS.fotografia.id, 1600), imageAlt: PHOTOS.fotografia.alt, credit: "Plantilla Minimal", meta: ["Galería", "Contacto", "Dominio propio"], accent: "#334155" },
];

export function RubrosCarousel({ bienvenidaHref }: { bienvenidaHref: string }) {
  return (
    <HeroCarousel items={RUBROS} defaultIndex={0} brand="Impulza One · Plantillas" label="Plantillas por rubro" className="h-[88vh] max-h-[860px] min-h-[36rem]">
      <a
        href={bienvenidaHref}
        className="order-last w-full rounded-[10px] bg-white px-5 py-3 text-center text-sm font-semibold text-[#0f172a] shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:order-none sm:w-auto"
      >
        Crear mi portal gratis
      </a>
    </HeroCarousel>
  );
}
