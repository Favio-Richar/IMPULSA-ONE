// 404 propio del render público (F2.7, "404 propio si no existe o no está publicado"): mismo
// mensaje exista de verdad el sitio/página o no — nunca hay que confirmar cuál de las dos cosas
// pasó, mismo criterio que el resto de la API (ADR-002, "404 y no 403 por id cruzado").
export default function SiteNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">404</p>
      <h1 className="text-2xl font-semibold text-neutral-900">Esta página no existe</h1>
      <p className="max-w-md text-neutral-600">
        El sitio o la página que buscas no está disponible, o todavía no se ha publicado.
      </p>
    </div>
  );
}
