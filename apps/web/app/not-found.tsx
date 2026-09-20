export default function RootNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-medium tracking-wide text-neutral-500 uppercase">404</p>
      <h1 className="text-2xl font-semibold text-neutral-900">Página no encontrada</h1>
      <p className="max-w-md text-neutral-600">La dirección a la que intentas llegar no existe.</p>
    </div>
  );
}
