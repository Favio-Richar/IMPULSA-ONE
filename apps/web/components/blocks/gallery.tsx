import type { GalleryBlockConfig } from "@impulza/validation";
import { SiteImage } from "../ui/site-image";

/**
 * "Carrusel" sin una línea de JavaScript: una fila con `scroll-snap`, que el navegador ya sabe
 * desplazar por gesto táctil, rueda del mouse o teclado (una vez enfocado el contenedor). Encaja
 * con "estados de carga/error resueltos, nunca en blanco" del criterio de aceptación sin agregar
 * una dependencia de carrusel ni lógica de cliente a una página que, hasta acá, es enteramente
 * estática.
 */
export function GalleryBlock({ config }: { config: GalleryBlockConfig }) {
  if (config.layout === "carousel") {
    return (
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2" tabIndex={0}>
        {config.images.map((image, index) => (
          <SiteImage
            key={index}
            image={image}
            className="h-64 w-64 shrink-0 snap-start rounded-[var(--site-radius)] border border-[var(--site-color-border)] object-cover shadow-[var(--site-shadow)]"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {config.images.map((image, index) => (
        <SiteImage
          key={index}
          image={image}
          className="aspect-square w-full rounded-[var(--site-radius)] border border-[var(--site-color-border)] object-cover shadow-[var(--site-shadow)]"
        />
      ))}
    </div>
  );
}
