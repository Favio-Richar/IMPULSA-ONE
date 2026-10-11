// Formato de precio de un plan de membresía (F10.2). Módulo SIN dependencias del servidor a propósito: lo importan componentes que
// corren en el navegador y no pueden arrastrar `./env` (la validación de variables de entorno falla fuera del servidor).

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

/** Precio para mostrar. Una moneda que no sea CLP se muestra como monto y código, sin adivinar decimales. */
export function formatPlanPrice(amount: number, currency: string): string {
  return currency === "CLP" ? money.format(amount) : `${amount} ${currency}`;
}
