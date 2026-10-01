import { currencyFractionDigits } from "@impulza/validation";

/**
 * Precio escrito por una persona → unidad mínima de la moneda (ISO 4217): "12.000" o "12000" para
 * CLP, "19,90" o "19.90" para monedas con decimales. `null` si el texto está vacío; `"invalid"` si
 * no es un monto válido (nunca adivina: el formulario muestra el error).
 */
export function parseMoneyInput(raw: string, currency: string): number | null | "invalid" {
  const text = raw.trim();
  if (text === "") return null;
  const digits = currencyFractionDigits(currency);
  const normalized = digits === 0 ? text.replace(/[.,\s]/g, "") : text.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return "invalid";
  const amount = Math.round(Number(normalized) * 10 ** digits);
  return Number.isFinite(amount) && amount >= 0 ? amount : "invalid";
}

/** La inversa, para precargar un formulario: 12990 CLP → "12990"; 1990 USD → "19.9". */
export function moneyToInput(amount: number, currency: string): string {
  return String(amount / 10 ** currencyFractionDigits(currency));
}
