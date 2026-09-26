import { Star } from "lucide-react";
import type { TestimonialsBlockConfig } from "@impulza/validation";
import { OUTBOUND_LINK } from "../ui/outbound.js";
import { SiteImage } from "../ui/site-image.js";
import { StackButtonContent, stackButtonClass, stackSurfaceClass } from "../ui/stack-button.js";

/** Promedio con un decimal en formato local ("4,9"); `null` si ninguna reseña trae calificación. */
function averageRating(config: TestimonialsBlockConfig): number | null {
  if (config.ratingAverage !== undefined) {
    return config.ratingAverage;
  }
  const ratings = config.items.flatMap((item) => (item.rating ? [item.rating] : []));
  return ratings.length > 0 ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10 : null;
}

/** Texto de la insignia: "4,9 · 128 reseñas", o solo "3 reseñas" si no hay calificaciones. */
export function testimonialsBadgeLabel(config: TestimonialsBlockConfig): string {
  const count = config.reviewCount ?? config.items.length;
  const reviews = `${count.toLocaleString("es-CL")} ${count === 1 ? "reseña" : "reseñas"}`;
  const average = averageRating(config);
  return average === null ? reviews : `${average.toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} · ${reviews}`;
}

/**
 * Reseñas como una insignia de la pila de enlaces (PL6, pedido de Favio del 2026-09-26): mismo
 * alto y ancho que los demás botones, con una estrella a la izquierda y "4,9 · 128 reseñas". En un
 * portal de enlace en bio las reseñas no son una caja de contenido en medio de la página.
 *
 * - Con `reviewsUrl`, la insignia lleva a la plataforma de reseñas del cliente (Google, Instagram…).
 * - Sin enlace, es un `<details>`: al tocarla se despliegan los testimonios completos justo debajo,
 *   sin JavaScript y sin sacar al visitante de la página.
 */
export function TestimonialsBlock({ config, glass = false }: { config: TestimonialsBlockConfig; glass?: boolean }) {
  const label = testimonialsBadgeLabel(config);
  const className = stackButtonClass(glass ? "glass" : "secondary");
  const icon = <Star className="h-5 w-5 shrink-0 fill-current" aria-hidden="true" />;
  const title = config.title ?? "Reseñas";

  if (config.reviewsUrl) {
    return (
      <a href={config.reviewsUrl} {...OUTBOUND_LINK} className={className} data-testimonials-badge="" aria-label={`${title}: ${label}`}>
        <StackButtonContent icon={icon} label={label} />
      </a>
    );
  }

  return (
    <details className="group" data-testimonials-badge="">
      <summary className={`${className} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} aria-label={`${title}: ${label}`}>
        <StackButtonContent icon={icon} label={label} />
      </summary>
      <ul className="mt-3 flex flex-col gap-3">
        {config.items.map((item, index) => (
          <li key={index} className={`${stackSurfaceClass(glass ? "glass" : "secondary")} px-5 py-4 text-left`}>
            <figure className="m-0 flex flex-col gap-2">
              {item.rating ? (
                <span role="img" className="text-sm font-medium" aria-label={`${item.rating} de 5 estrellas`}>
                  {"★".repeat(item.rating)}
                </span>
              ) : null}
              <blockquote className="m-0 text-sm">“{item.quote}”</blockquote>
              <figcaption className="flex items-center gap-3 text-sm">
                {item.avatar ? <SiteImage image={item.avatar} sizes="32px" className="h-8 w-8 rounded-full object-cover" /> : null}
                <span>
                  <span className="font-medium">{item.author}</span>
                  {item.role ? <span> · {item.role}</span> : null}
                </span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </details>
  );
}
