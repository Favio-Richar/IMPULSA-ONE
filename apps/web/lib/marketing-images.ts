// Fotos del sitio comercial (portada con corredor y carrusel de rubros). Todas de Unsplash (licencia
// Unsplash: uso comercial permitido, sin atribución obligatoria) y enlazadas desde su CDN, como pide
// Unsplash. Elegidas por rubro de negocio y revisadas una por una: ninguna muestra marcas ajenas.

/** URL del CDN de Unsplash recortada al ancho pedido. */
export function unsplash(photoId: string, width: number): string {
  return `https://images.unsplash.com/${photoId}?w=${width}&q=70&auto=format&fit=crop`;
}

export interface MarketingPhoto {
  id: string;
  alt: string;
}

export const PHOTOS = {
  barberia: { id: "photo-1503951914875-452162b0f3f1", alt: "Barbero afeitando a un cliente" },
  cafeTazas: { id: "photo-1495474472287-4d71bcdd2085", alt: "Tazas de café con arte latte" },
  cafeLocal: { id: "photo-1554118811-1e0d58224f24", alt: "Interior de una cafetería con plantas" },
  tienda: { id: "photo-1441986300917-64674bd600d8", alt: "Tienda de ropa con estanterías" },
  bienestar: { id: "photo-1544367567-0f2fcb009e0b", alt: "Persona haciendo yoga al atardecer" },
  fiesta: { id: "photo-1492684223066-81342ee5ff30", alt: "Público de un evento bajo lluvia de papel picado" },
  creadora: { id: "photo-1494790108377-be9c29b29330", alt: "Mujer sonriendo, retrato" },
  panaderia: { id: "photo-1509440159596-0249088772ff", alt: "Panes de masa madre y espigas" },
  fotografia: { id: "photo-1516035069371-29a1b244cc32", alt: "Cámara y lentes sobre una mesa oscura" },
  salud: { id: "photo-1576091160399-112ba8d25d1d", alt: "Profesional de la salud usando su teléfono" },
  restaurante: { id: "photo-1504674900247-0877df9cc836", alt: "Plato de carne con ensalada" },
  concierto: { id: "photo-1470229722913-7c0e2dbbafd3", alt: "Concierto con luces sobre el público" },
  retrato: { id: "photo-1531746020798-e6953c6e8e04", alt: "Retrato de mujer sobre fondo rosado" },
  consultoria: { id: "photo-1600880292203-757bb62b4baf", alt: "Dos personas celebrando en una oficina" },
  caja: { id: "photo-1556740738-b6a63e27c4df", alt: "Vendedora atendiendo en una caja" },
} satisfies Record<string, MarketingPhoto>;
