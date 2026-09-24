import { useEffect, useState } from "react";

/** El valor, pero solo después de `delayMs` sin cambios: una búsqueda por tecla sin inundar la API. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
