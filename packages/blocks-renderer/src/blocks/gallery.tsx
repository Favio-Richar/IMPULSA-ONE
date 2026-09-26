import type { GalleryBlockConfig } from "@impulza/validation";
import { SiteImage } from "../ui/site-image.js";
import { stackSurfaceClass } from "../ui/stack-button.js";

/**
 * "Carrusel" sin una línea de JavaScript: una fila con `scroll-snap`, que el navegador ya sabe
 * desplazar por gesto táctil, rueda del mouse o teclado (una vez enfocado el contenedor). Encaja
 * con "estados de carga/error resueltos, nunca en blanco" del criterio de aceptación sin agregar
 * una dependencia de carrusel ni lógica de cliente a una página que, hasta acá, es enteramente
 * estática.
 *
 * PL6: cada foto lleva la superficie de la pila de botones (borde, radio y sombra del tema; `glass`
 * sobre fondo oscuro o foto), así la galería se lee como parte de la pila y no como un catálogo
 * aparte.
 */
export function GalleryBlock({ config, glass = false }: { config: GalleryBlockConfig; glass?: boolean }) {
  const surface = stackSurfaceClass(glass ? "glass" : "secondary");

  if (config.layout === "carousel") {
    return (
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2" tabIndex={0}>
        {config.images.map((image, index) => (
          <SiteImage
            key={index}
            image={image}
            sizes="256px"
            className={`${surface} h-64 w-64 shrink-0 snap-start object-cover`}
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
          sizes="(min-width: 640px) 240px, 50vw"
          className={`${surface} aspect-square w-full object-cover`}
        />
      ))}
    </div>
  );
}
