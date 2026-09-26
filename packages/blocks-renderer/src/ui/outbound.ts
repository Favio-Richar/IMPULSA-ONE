/**
 * Atributos de todo enlace que sale de la página pública (PP8). Como en una página de enlaces, el
 * destino se abre **ahí mismo**, en la misma pestaña: dentro del navegador de Instagram o TikTok,
 * una pestaña nueva es confusa y a veces ni existe, y un enlace a una red abre directo su app.
 *
 * `nofollow`: la página no le transfiere reputación de buscador a cada destino. Sin `target`, no
 * hace falta `noopener` (la página de destino no recibe `window.opener`).
 */
export const OUTBOUND_LINK = { rel: "nofollow" } as const;
