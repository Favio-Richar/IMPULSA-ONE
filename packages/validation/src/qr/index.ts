import { z } from "zod";

// Catálogo cerrado de estilos de QR (F3.5) — mismo criterio que el catálogo de temas (F2.5): el
// usuario elige de un conjunto con el contraste ya verificado (contrast.test.ts de este paquete),
// nunca escribe un color libre. Un QR con poco contraste entre módulos y fondo simplemente no
// escanea de forma confiable — acá el mínimo no es solo estético (WCAG), es funcional.
//
// Deliberadamente sin presets "invertidos" (módulos claros sobre fondo oscuro): escanean peor en
// la práctica con cámaras de gama baja, y el objetivo es que el QR funcione siempre, no que se
// vea distintivo.

export interface QrStylePreset {
  key: string;
  name: string;
  foreground: string;
  background: string;
}

export const QR_STYLE_CATALOG: readonly QrStylePreset[] = [
  { key: "clasico", name: "Clásico", foreground: "#000000", background: "#ffffff" },
  // Tono más oscuro que el primario de marca (#0f6f6b, 5.99:1): un QR necesita más contraste que
  // un botón para escanear de forma confiable — este llega a ~8.76:1.
  { key: "marca", name: "Marca", foreground: "#0b5450", background: "#ffffff" },
  { key: "carbon", name: "Carbón", foreground: "#10201e", background: "#ffffff" },
];

export const QR_STYLE_KEYS = QR_STYLE_CATALOG.map((preset) => preset.key) as [string, ...string[]];
export const qrStyleKeySchema = z.enum(QR_STYLE_KEYS);

export function getQrStylePreset(key: string): QrStylePreset | null {
  return QR_STYLE_CATALOG.find((preset) => preset.key === key) ?? null;
}
