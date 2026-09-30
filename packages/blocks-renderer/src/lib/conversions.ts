import { CONVERSION_EVENT_NAME, type ConversionEvent } from "@impulza/validation";

/**
 * Un bloque anuncia una conversión (formulario enviado, reserva o pedido creado) con un evento del
 * navegador (F7.1, ADR-016). El bloque no sabe de GA4 ni de Meta: en la página pública, el
 * componente de medición lo traduce **solo** si el sitio tiene medición y el visitante consintió;
 * en la vista previa del constructor nadie escucha. Nunca lleva datos personales, y nunca hace
 * fallar al bloque.
 */
export function emitConversion(event: ConversionEvent): void {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<ConversionEvent>(CONVERSION_EVENT_NAME, { detail: event }));
  } catch {
    // La medición es una métrica, no una condición para que el bloque funcione.
  }
}
