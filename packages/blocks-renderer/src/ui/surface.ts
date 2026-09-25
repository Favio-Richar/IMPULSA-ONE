/**
 * Clases para toda tarjeta o superficie (`--site-color-surface`) del render público (PP3). Un fondo
 * de página oscuro cambia `--site-color-foreground` y compañía para el texto que va directo sobre
 * él; dentro de una tarjeta, el fondo vuelve a ser la superficie del tema, así que el texto tiene
 * que volver a la paleta del tema (`--site-theme-*`) — si no, quedaría texto blanco sobre una
 * tarjeta blanca. Sin un fondo propio, estas variables valen lo mismo y no cambian nada.
 */
export const SURFACE_SCOPE =
  "[--site-color-foreground:var(--site-theme-foreground)] [--site-color-muted-foreground:var(--site-theme-muted-foreground)] [--site-color-border:var(--site-theme-border)] [--site-color-link:var(--site-color-primary)]";
