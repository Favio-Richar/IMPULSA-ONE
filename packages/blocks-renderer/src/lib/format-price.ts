/**
 * `priceAmount` está en la unidad mínima de la moneda (ST §8): centavos para USD o EUR, pero el
 * peso chileno no tiene decimales — su unidad mínima es el peso. Dividir siempre por 100 mostraba
 * un brunch de $12.900 como "$129". Cuántos decimales usa cada moneda lo sabe Intl (ISO 4217).
 */
export function formatPrice(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat("es-CL", { style: "currency", currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amount / 10 ** fractionDigits);
}
