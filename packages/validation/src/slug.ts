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

// Slug público de un sitio: además del formato, no puede ser uno reservado. La colisión con otro
// sitio o con una redirección viva es una regla entre tablas y se verifica en la API (F2.2).
export const publicSlugSchema = slugSchema.refine((slug) => !isReservedSlug(slug), {
  message: "Ese nombre está reservado por la plataforma. Elige otro.",
});
