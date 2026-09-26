"use client";

import { useState } from "react";

/**
 * Avatar de ejemplo (ilustración generada, no una foto real de nadie) para previsualizar cómo
 * luce una plantilla con foto de perfil. Es contenido de demostración: el usuario lo reemplaza
 * por su propia foto desde el panel de Impulza One al personalizar su portal. Si la imagen
 * externa no carga, se muestra un respaldo con las iniciales de la plantilla.
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
