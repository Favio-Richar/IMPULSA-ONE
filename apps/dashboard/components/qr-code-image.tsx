"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

/** Renderiza un QR real en el propio navegador (F3.5) — no se genera ni se guarda como imagen en
 *  el servidor: no hay biblioteca multimedia todavía (F3.1, decisión #7 pendiente), así que se
 *  dibuja on-demand a partir del destino, cada vez que se necesita ver o descargar. */
export function QrCodeImage({
  value,
  foreground,
  background,
  size = 176,
}: {
  value: string;
  foreground: string;
  background: string;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }
    void QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 1,
      color: { dark: foreground, light: background },
    });
  }, [value, foreground, background, size]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Código QR hacia ${value}`}
      className="rounded-md border border-border"
    />
  );
}
