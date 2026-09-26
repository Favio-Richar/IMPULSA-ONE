import type { FaqBlockConfig } from "@impulza/validation";
import { RichText } from "../ui/rich-text.js";
import { stackSurfaceClass } from "../ui/stack-button.js";

/**
 * `<details>/<summary>` nativos: acordeón accesible por teclado y lector de pantalla sin una
 * línea de JavaScript — el navegador ya implementa el patrón ARIA `disclosure` correctamente.
 *
 * PL6: cada pregunta es un elemento más de la pila de botones (misma superficie, alto mínimo y
 * variante `glass`), no una caja aparte con divisores; el título es un encabezado corto de sección.
 */
export function FaqBlock({ config, glass = false }: { config: FaqBlockConfig; glass?: boolean }) {
  const surface = stackSurfaceClass(glass ? "glass" : "secondary");
  return (
    <div className="flex flex-col gap-3">
      {config.title ? (
        <h2 className="text-center text-base font-semibold text-[var(--site-color-foreground)]">{config.title}</h2>
      ) : null}
      {config.items.map((item, index) => (
        <details key={index} className={`group ${surface}`}>
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-medium marker:content-none [&::-webkit-details-marker]:hidden">
            {item.question}
            <span aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-45 motion-reduce:transition-none">
              +
            </span>
          </summary>
          <div className="px-5 pb-4">
            <RichText html={item.answer} className="text-sm" />
          </div>
        </details>
      ))}
    </div>
  );
}
