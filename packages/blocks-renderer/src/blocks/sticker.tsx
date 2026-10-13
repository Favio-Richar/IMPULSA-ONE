import { getSticker, STICKER_SIZE_PX, type StickerBlockConfig, type StickerElement, type StickerFill } from "@impulza/validation";
import type { CSSProperties } from "react";

/** Los roles de color de un sticker, resueltos a las variables del tema de la página (sus pares ya se verifican AA). */
const FILLS: Record<StickerFill, string> = {
  primary: "var(--site-color-primary)",
  onPrimary: "var(--site-color-primary-foreground)",
  ink: "var(--site-color-foreground)",
  surface: "var(--site-color-surface)",
  none: "none",
};

const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" } as const;

function Element({ element }: { element: StickerElement }) {
  switch (element.type) {
    case "path":
      return (
        <path
          d={element.d}
          fill={FILLS[element.fill ?? "none"]}
          stroke={element.stroke ? FILLS[element.stroke] : "none"}
          strokeWidth={element.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "circle":
      return (
        <circle
          cx={element.cx}
          cy={element.cy}
          r={element.r}
          fill={FILLS[element.fill ?? "none"]}
          stroke={element.stroke ? FILLS[element.stroke] : "none"}
          strokeWidth={element.strokeWidth}
        />
      );
    case "text":
      return (
        <text
          x={element.x}
          y={element.y}
          fontSize={element.size}
          fontWeight={800}
          textAnchor="middle"
          fill={FILLS[element.fill]}
          // El texto se ajusta al ancho del sello: nunca se sale de la forma, con cualquier tipografía del tema.
          {...(element.fit ? { textLength: element.fit, lengthAdjust: "spacingAndGlyphs" as const } : {})}
          style={{ fontFamily: "var(--site-font-heading)" }}
          {...(element.rotate ? { transform: `rotate(${element.rotate} ${element.x} ${element.y})` } : {})}
        >
          {element.text}
        </text>
      );
  }
}

/**
 * Sticker o decoración (extra F10). Es puramente decorativo: va oculto a los lectores de pantalla (`aria-hidden`) y no recibe
 * foco, así que no interrumpe el orden de lectura de los demás bloques. Dibuja un sticker del catálogo cerrado como SVG real
 * (elementos de React, nunca marcado inyectado), con los colores del tema. Un id desconocido (un catálogo que cambió) no pinta nada.
 */
export function StickerBlock({ config }: { config: StickerBlockConfig }) {
  const sticker = getSticker(config.stickerId);
  if (!sticker) {
    return null;
  }
  const size = STICKER_SIZE_PX[config.size];
  const style: CSSProperties = { width: size, height: size, transform: `rotate(${config.rotation}deg)` };
  return (
    <div
      aria-hidden="true"
      data-sticker={sticker.id}
      className="flex w-full"
      style={{ justifyContent: JUSTIFY[config.alignment] }}
    >
      <svg viewBox="0 0 100 100" focusable="false" role="presentation" style={style} className="shrink-0 overflow-visible">
        {sticker.elements.map((element, index) => (
          <Element key={index} element={element} />
        ))}
      </svg>
    </div>
  );
}
