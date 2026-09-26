/**
 * `fetch` hacia apps/api desde una ruta del sitio público. Si la API no responde (reinicio,
 * despliegue, red), devuelve `null` en vez de lanzar: la ruta contesta 502 limpio y queda una línea
 * de log estructurada, sin la traza de un error sin manejar. Nunca registra el cuerpo (puede traer
 * datos personales de un formulario).
 */
export async function fetchUpstream(route: string, url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, init);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "impulza-web",
        message: "La API no respondió",
        route,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}
