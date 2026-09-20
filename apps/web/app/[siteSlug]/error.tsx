"use client";

import { useEffect } from "react";

// Los límites de error de Next.js son, por convención, Componentes de Cliente — necesitan
// `reset()` para reintentar sin recargar toda la página (F2.7, "estados... de error resueltos,
// nunca una página en blanco"). Nunca expone `error.message` cruda: puede traer detalles internos
// (una URL de la API, un stack) que un visitante sin sesión no tiene por qué ver.
export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Sin un logger de cliente propio todavía — suficiente para depurar en desarrollo, y el
    // digest de este error queda igual en los logs del servidor.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold text-neutral-900">Algo salió mal</h1>
      <p className="max-w-md text-neutral-600">
        No pudimos cargar esta página. Puede ser algo temporal — intenta de nuevo.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        Reintentar
      </button>
    </div>
  );
}
