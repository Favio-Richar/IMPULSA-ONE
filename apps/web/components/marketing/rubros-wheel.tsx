import type { CSSProperties } from "react";
import { WorksWheelBlock } from "@impulza/blocks-renderer";
import { PHOTOS, unsplash } from "@/lib/marketing-images";

// «Un portal para cada rubro»: la rueda de trabajos (el mismo bloque que los negocios agregan a su página) como vitrina
// del sitio comercial. Cada pieza lleva a la galería de plantillas. Los colores son los del sitio comercial (claro),
// definidos acá porque el bloque lee los tokens `--site-*` del tema de un sitio.

const PIECES = [
  { title: "Barberías", photo: PHOTOS.barberia },
  { title: "Cafés", photo: PHOTOS.cafeTazas },
  { title: "Tiendas", photo: PHOTOS.tienda },
  { title: "Bienestar", photo: PHOTOS.bienestar },
  { title: "Creadores", photo: PHOTOS.creadora },
  { title: "Eventos", photo: PHOTOS.concierto },
  { title: "Fotografía", photo: PHOTOS.fotografia },
  { title: "Gastronomía", photo: PHOTOS.restaurante },
] as const;

const MARKETING_THEME = {
  "--site-color-foreground": "#0f172a",
  "--site-color-muted-foreground": "#475569",
  "--site-color-surface": "#f8fafc",
  "--site-color-border": "#e2e8f0",
  "--site-color-primary": "#0f6f6b",
  "--site-color-primary-foreground": "#ffffff",
  "--site-radius": "0.75rem",
  "--site-shadow": "0 10px 30px -12px rgb(15 23 42 / 0.35)",
} as CSSProperties;

export function RubrosWheel() {
  const config = {
    label: "Un portal para tu rubro",
    actionLabel: "Ver plantillas",
    items: PIECES.map((piece) => ({
      title: piece.title,
      image: { url: unsplash(piece.photo.id, 900), alt: piece.photo.alt },
      link: "/plantillas",
    })),
  };
  return (
    <div style={MARKETING_THEME} className="mx-auto w-full max-w-5xl text-[#0f172a]">
      <WorksWheelBlock config={config} />
    </div>
  );
}
