import type { FieldControl, FieldDescriptor } from "./types.js";

function defaultLeafValue(control: FieldControl, optional: boolean | undefined): unknown {
  switch (control.kind) {
    case "text":
    case "url":
    case "email":
    case "phone":
    case "richtext":
    case "video":
      return "";
    case "number":
      return undefined;
    case "boolean":
      return false;
    case "select":
      // Un `<select>` sin opción en blanco muestra visualmente su primera opción aunque el
      // formulario no la haya elegido todavía — si el campo es requerido, el valor inicial tiene
      // que ser esa misma opción o el primer autoguardado falla con "opción inválida" apenas se
      // agrega el ítem, antes de que el usuario toque nada. Uno opcional sí puede arrancar vacío
      // (`—`, sin selección).
      return optional ? "" : (control.options[0]?.value ?? "");
    case "multiselect":
      return [];
    case "image":
      return { url: "", alt: "" };
    case "group":
      return defaultObject(control.fields);
    case "array":
      return [];
  }
}

function defaultObject(fields: readonly FieldDescriptor[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field.name] = defaultLeafValue(field.control, field.optional);
  }
  return result;
}

/** Valor inicial de un ítem nuevo agregado a un campo `array` (p. ej. "Agregar red" en
 *  `social.links`) — un objeto controlado válido para el formulario, no lo que espera el schema
 *  final (eso lo resuelve `normalizeBlockConfig` al guardar). */
export function defaultArrayItem(fields: readonly FieldDescriptor[]): Record<string, unknown> {
  return defaultObject(fields);
}
