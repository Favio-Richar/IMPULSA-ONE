"use client";

import { useState } from "react";

/**
 * Avatar de ejemplo (ilustración generada, no una foto real de nadie) para el mosaico decorativo
 * de las pantallas de acceso (login/registro/verificación). Mismo criterio que el avatar de
 * ejemplo de las plantillas en el sitio comercial: si la imagen externa no carga, se muestra un
 * respaldo con las iniciales.
 */
export function TemplateAvatar({ src, fallbackLabel }: { src: string; fallbackLabel: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <span aria-hidden="true">{fallbackLabel}</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- avatar de ejemplo externo (SVG generado), no una imagen del proyecto
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={56}
      height={56}
      className="h-full w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}
