// Motor de formularios de configuración de bloques (F2.9, Etapa B1). Un descriptor declarativo por
// campo en vez de un formulario a mano por cada uno de los 15 tipos del catálogo
// (`@impulza/validation`, `BLOCK_CATALOG`): la validación real sigue viviendo en el mismo schema
// Zod de siempre (`zodResolver` sobre `BLOCK_CATALOG[type].schema`), esto solo describe qué control
// pintar para cada campo de ese schema.

export type FieldControl =
  | { kind: "text"; maxLength: number }
  | { kind: "richtext" }
  | { kind: "number"; min?: number; max?: number; step?: number }
  | { kind: "boolean" }
  | { kind: "select"; options: ReadonlyArray<{ value: string; label: string }> }
  | { kind: "url" }
  | { kind: "email" }
  | { kind: "phone" }
  /** Objeto `{ url, alt, decorative }` — mismo `imageSchema` en todo el catálogo (F2.4). `aspect`
   *  solo guía al elegir la imagen (PP2): cuadrada para avatares, horizontal para portadas. */
  | { kind: "image"; aspect?: "square" | "wide" }
  /** `videoEmbedSchema` (`@impulza/validation`): en el servidor es `{provider, videoId}`, pero
   *  acepta indistintamente esa forma o una URL de YouTube/Vimeo — el campo siempre edita una URL
   *  de texto; `toFormConfig` reconstruye una URL de ida y vuelta al cargar un bloque guardado. */
  | { kind: "video" }
  /** Selección múltiple de un conjunto fijo de opciones, como arreglo de strings (p. ej.
   *  `contact_form.fields`) — no un arreglo de objetos, por eso no es un campo `array`. */
  | { kind: "multiselect"; options: ReadonlyArray<{ value: string; label: string }>; min: number; max: number }
  /** Objeto anidado opcional con sus propios campos (p. ej. `cta: { label, url }`). */
  | { kind: "group"; fields: readonly FieldDescriptor[] }
  /** Arreglo repetible de objetos (p. ej. `social.links`, `faq.items`). */
  | {
      kind: "array";
      min: number;
      max: number;
      itemLabel: string;
      fields: readonly FieldDescriptor[];
      /** Cada ítem es una imagen completa (`gallery.images`): se edita con el selector de imágenes. */
      itemKind?: "image";
    };

export interface FieldDescriptor {
  /** Nombre del campo dentro de su objeto contenedor — no el path completo dentro del form. */
  name: string;
  label: string;
  control: FieldControl;
  optional?: boolean;
  helperText?: string;
}

export interface BlockFieldSet {
  fields: readonly FieldDescriptor[];
  /** Config inicial válida contra el schema del tipo al agregarlo desde la biblioteca —
   *  placeholders reales para los campos requeridos que no tienen default en el schema, para que
   *  el primer `POST` sea válido y el usuario edite desde un bloque real. */
  seedConfig: () => Record<string, unknown>;
}
