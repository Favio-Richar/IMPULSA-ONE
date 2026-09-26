import { z } from "zod";

// Slug URL-safe: minúsculas, dígitos y guiones, sin guiones al borde. Vive acá y no en un DTO de
// la API porque el constructor (F2.9) necesita la misma regla para dar feedback inmediato — pero
// el servidor la vuelve a aplicar siempre, nunca confía en la validación del cliente (ST §15).
export const slugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Solo minúsculas, dígitos y guiones (sin empezar/terminar en guión).");

// Nombres que no puede tomar un usuario porque colisionan con infraestructura, rutas propias de
// la plataforma o convenciones que romperían el enrutado público (F2.2).
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Infraestructura y convenciones de red.
  "www",
  "api",
  "cdn",
  "static",
  "assets",
  "media",
  "mail",
  "smtp",
  "ftp",
  "ns",
  "mx",
  "webmail",
  "autodiscover",
  // Espacio de rutas de enlaces cortos y QR (F3.5, `apps/web/app/s/[slug]` y `app/qr/[qrCodeId]`).
  // Ya bloqueado en la práctica por el mínimo de 3 caracteres de arriba ("s" y "qr" no lo pasan);
  // acá igual por si ese mínimo cambia alguna vez — que un sitio no pueda colisionar con estas
  // rutas nunca debería depender solo de un efecto colateral de otra regla.
  "s",
  "qr",
  // "Tu reserva" (F5.4, `apps/web/app/reserva/[token]`): una ruta fija gana sobre `[siteSlug]`, así
  // que un sitio con este slug quedaría inalcanzable.
  "reserva",
  "reservas",
  // Superficies propias de la plataforma.
  "admin",
  "app",
  "panel",
  "dashboard",
  "auth",
  "login",
  "logout",
  "signup",
  "registro",
  "register",
  "account",
  "cuenta",
  "settings",
  "configuracion",
  "billing",
  "facturacion",
  "checkout",
  "onboarding",
  "impulza",
  "impulzaone",
  // Contenido institucional y archivos especiales.
  "blog",
  "docs",
  "help",
  "ayuda",
  "support",
  "soporte",
  "status",
  "legal",
  "privacidad",
  "privacy",
  "terminos",
  "terms",
  "contacto",
  "contact",
  "about",
  "sitemap",
  "robots",
  "favicon",
  "health",
  // Entornos, para no confundir un sitio de usuario con uno nuestro.
  "dev",
  "test",
  "staging",
  "preview",
  // Valores que suelen filtrarse por bugs y no deben poder reservarse.
  "null",
  "undefined",
  "none",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

// Slug público de un SITIO: además del formato, no puede ser uno reservado — vive en el mismo
// espacio de nombres que las rutas de la plataforma. La colisión con otro sitio o con una
// redirección viva es una regla entre tablas y se verifica en la API (F2.2).
export const publicSlugSchema = slugSchema.refine((slug) => !isReservedSlug(slug), {
  message: "Ese nombre está reservado por la plataforma. Elige otro.",
});

// Slug de una PÁGINA dentro de un sitio: solo formato, sin lista de reservados. La lista de arriba
// protege el espacio de nombres de la plataforma, que es un nivel más arriba; dentro de su propio
// sitio el usuario debe poder llamar a sus páginas "contacto", "blog" o "soporte" — de hecho son
// los nombres más probables. Lo único que compite ahí es otra página del mismo sitio, y eso lo
// resuelve el índice único parcial por (site_id, slug) (F2.3).
export const pageSlugSchema = slugSchema;

/**
 * Slug de la página de inicio de todo sitio. No aparece en la URL pública (la home se sirve en la
 * raíz del sitio, F2.7); existe para que la home ocupe el mismo espacio de nombres que el resto y
 * nadie pueda crear otra página que colisione con ella. Es fijo: no se puede renombrar ni borrar.
 *
 * Isomorfo a propósito: `apps/api` la usa para crear la home de todo sitio nuevo (F2.2) y
 * `apps/web` la misma constante para saber qué página pedirle al endpoint público cuando resuelve
 * la raíz de un sitio (F2.7) — un solo lugar, no dos copias del mismo string que puedan divergir.
 */
export const HOME_PAGE_SLUG = "inicio";
