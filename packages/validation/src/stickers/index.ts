// Catálogo CERRADO de stickers y decoraciones (extra F10). Cada uno es un SVG propio, armado con trazos y formas simples: nada se
// sube, nada es un logo ni un ícono de marca de terceros, y no existe forma de meter marcado arbitrario (un sticker no es una
// cadena SVG: es una lista de elementos con colores del TEMA, que el render pinta con React). Así el único camino para agregar
// una decoración sigue siendo un bloque del catálogo, con su esquema validado en el servidor.
//
// Los colores no son hex: son roles del tema (`primary`, `onPrimary`, `ink`, `surface`). El render los resuelve a las variables
// `--site-color-*` de la página, cuyos pares ya se verifican AA (texto sobre acento, acento sobre fondo). Un sticker se ve bien
// en cualquier tema y sobre cualquier fondo.

/** Roles de color de un sticker. */
export type StickerFill = "primary" | "onPrimary" | "ink" | "surface" | "none";

export type StickerElement =
  | { type: "path"; d: string; fill?: StickerFill; stroke?: StickerFill; strokeWidth?: number }
  | { type: "circle"; cx: number; cy: number; r: number; fill?: StickerFill; stroke?: StickerFill; strokeWidth?: number }
  | {
      type: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      fill: StickerFill;
      /** Ancho al que se ajusta el texto (`textLength`): garantiza que quepa dentro del sello. */
      fit?: number;
      rotate?: number;
    };

export const STICKER_CATEGORIES = [
  { id: "flechas", label: "Flechas" },
  { id: "formas", label: "Formas" },
  { id: "decorativos", label: "Decorativos" },
  { id: "sellos", label: "Sellos y textos" },
] as const;
export type StickerCategory = (typeof STICKER_CATEGORIES)[number]["id"];

export interface StickerDefinition {
  id: string;
  category: StickerCategory;
  name: string;
  /** Siempre en una caja de 100 × 100. */
  elements: readonly StickerElement[];
}

export const STICKER_SIZES = ["sm", "md", "lg"] as const;
export type StickerSize = (typeof STICKER_SIZES)[number];
/** Ancho en píxeles de cada tamaño (el alto es el mismo: el sticker es cuadrado). */
export const STICKER_SIZE_PX: Record<StickerSize, number> = { sm: 56, md: 96, lg: 160 };
export const STICKER_ALIGNMENTS = ["left", "center", "right"] as const;
export type StickerAlignment = (typeof STICKER_ALIGNMENTS)[number];
export const STICKER_ROTATION_MIN = -30;
export const STICKER_ROTATION_MAX = 30;

// ---- constructores de forma --------------------------------------------------------------------------------------

const r1 = (value: number): string => (Math.round(value * 10) / 10).toString();

/** Estrella (o ráfaga) de `points` puntas, con radio exterior e interior; arranca mirando hacia arriba. */
function starPath(points: number, outer: number, inner: number, cx = 50, cy = 50): string {
  const steps = points * 2;
  const coords: string[] = [];
  for (let index = 0; index < steps; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI * 2 * index) / steps - Math.PI / 2;
    coords.push(`${r1(cx + radius * Math.cos(angle))} ${r1(cy + radius * Math.sin(angle))}`);
  }
  return `M${coords.join("L")}Z`;
}

const stroke = (d: string, color: StickerFill = "primary", strokeWidth = 8): StickerElement => ({ type: "path", d, stroke: color, strokeWidth, fill: "none" });
const solid = (d: string, fill: StickerFill = "primary"): StickerElement => ({ type: "path", d, fill });
const dot = (cx: number, cy: number, r: number, fill: StickerFill = "ink"): StickerElement => ({ type: "circle", cx, cy, r, fill });
const label = (x: number, y: number, text: string, size: number, fit: number, fill: StickerFill = "onPrimary"): StickerElement => ({ type: "text", x, y, text, size, fill, fit });

/** Un sello: ráfaga de 12 puntas con una o dos líneas de texto encima. */
function seal(id: string, name: string, lines: readonly string[], size: number, fit: number): StickerDefinition {
  const lineHeight = size + 3;
  const first = 50 - ((lines.length - 1) * lineHeight) / 2 + size / 3;
  return {
    id,
    category: "sellos",
    name,
    elements: [solid(starPath(12, 48, 40)), ...lines.map((text, index) => label(50, first + index * lineHeight, text, size, fit))],
  };
}

export const STICKER_CATALOG: readonly StickerDefinition[] = [
  // ---- flechas -------------------------------------------------------------------------------------------------
  { id: "flecha-derecha", category: "flechas", name: "Flecha a la derecha", elements: [stroke("M12 50H84M60 26L86 50L60 74", "primary", 9)] },
  { id: "flecha-izquierda", category: "flechas", name: "Flecha a la izquierda", elements: [stroke("M88 50H16M40 26L14 50L40 74", "primary", 9)] },
  { id: "flecha-arriba", category: "flechas", name: "Flecha hacia arriba", elements: [stroke("M50 88V16M26 40L50 14L74 40", "primary", 9)] },
  { id: "flecha-abajo", category: "flechas", name: "Flecha hacia abajo", elements: [stroke("M50 12V84M26 60L50 86L74 60", "primary", 9)] },
  { id: "flecha-diagonal", category: "flechas", name: "Flecha en diagonal", elements: [stroke("M20 80L78 22M42 20H80V58", "primary", 9)] },
  { id: "flecha-curva", category: "flechas", name: "Flecha curva", elements: [stroke("M14 74C24 24 66 14 86 46M66 40L88 48L74 68", "ink", 7)] },
  { id: "flecha-curva-abajo", category: "flechas", name: "Flecha curva hacia abajo", elements: [stroke("M24 14C84 16 88 58 50 80M42 62L48 88L72 76", "ink", 7)] },
  { id: "flecha-doble", category: "flechas", name: "Flecha doble", elements: [stroke("M10 50H90M30 30L10 50L30 70M70 30L90 50L70 70", "primary", 8)] },
  { id: "flecha-garabato", category: "flechas", name: "Flecha garabateada", elements: [stroke("M10 72C22 30 44 30 40 54C36 74 20 62 36 46C52 30 72 40 88 30M72 18L90 30L74 46", "ink", 6)] },
  { id: "flecha-chevron", category: "flechas", name: "Chevrón doble", elements: [stroke("M28 20L58 50L28 80M50 20L80 50L50 80", "primary", 10)] },
  { id: "flecha-bloque", category: "flechas", name: "Flecha sólida", elements: [solid("M8 38H58V18L92 50L58 82V62H8Z")] },

  // ---- formas --------------------------------------------------------------------------------------------------
  { id: "circulo", category: "formas", name: "Círculo", elements: [dot(50, 50, 40, "primary")] },
  { id: "anillo", category: "formas", name: "Anillo", elements: [{ type: "circle", cx: 50, cy: 50, r: 34, stroke: "primary", strokeWidth: 12, fill: "none" }] },
  { id: "cuadrado", category: "formas", name: "Cuadrado", elements: [solid("M16 16H84V84H16Z")] },
  { id: "triangulo", category: "formas", name: "Triángulo", elements: [solid("M50 12L90 84H10Z")] },
  { id: "rombo", category: "formas", name: "Rombo", elements: [solid("M50 8L92 50L50 92L8 50Z")] },
  { id: "estrella", category: "formas", name: "Estrella", elements: [solid(starPath(5, 46, 19))] },
  { id: "rafaga", category: "formas", name: "Ráfaga", elements: [solid(starPath(12, 48, 38))] },
  { id: "corazon", category: "formas", name: "Corazón", elements: [solid("M50 88C20 64 8 46 8 31C8 18 18 9 30 9C40 9 46 15 50 23C54 15 60 9 70 9C82 9 92 18 92 31C92 46 80 64 50 88Z")] },
  { id: "cruz", category: "formas", name: "Cruz", elements: [solid("M38 10H62V38H90V62H62V90H38V62H10V38H38Z")] },
  { id: "hexagono", category: "formas", name: "Hexágono", elements: [solid("M50 8L87 29V71L50 92L13 71V29Z")] },
  { id: "mancha", category: "formas", name: "Mancha", elements: [solid("M62 10C84 12 94 34 88 54C82 76 62 92 40 88C18 84 8 62 14 42C20 22 42 8 62 10Z")] },
  { id: "zigzag", category: "formas", name: "Zigzag", elements: [stroke("M8 64L24 38L40 64L56 38L72 64L90 38", "primary", 9)] },
  { id: "onda", category: "formas", name: "Onda", elements: [stroke("M6 50C18 22 30 22 42 50C54 78 66 78 78 50C86 32 92 32 96 40", "primary", 8)] },
  { id: "arco", category: "formas", name: "Arco", elements: [stroke("M12 72A38 38 0 0 1 88 72", "primary", 14)] },
  {
    id: "puntos",
    category: "formas",
    name: "Cuadrícula de puntos",
    elements: [20, 50, 80].flatMap((cy) => [20, 50, 80].map((cx) => dot(cx, cy, 6, "ink"))),
  },

  // ---- decorativos ---------------------------------------------------------------------------------------------
  { id: "subrayado", category: "decorativos", name: "Subrayado recto", elements: [stroke("M8 60H92", "primary", 10)] },
  { id: "subrayado-onda", category: "decorativos", name: "Subrayado ondulado", elements: [stroke("M6 56C18 40 30 40 42 56C54 72 66 72 78 56C86 46 90 46 94 50", "primary", 8)] },
  { id: "subrayado-doble", category: "decorativos", name: "Subrayado de trazo libre", elements: [stroke("M8 44C30 38 60 40 92 36M12 66C40 60 66 64 90 58", "primary", 6)] },
  { id: "pincelada", category: "decorativos", name: "Pincelada", elements: [solid("M6 54C20 36 44 40 60 44C76 48 88 40 94 34C93 52 86 66 70 68C52 72 30 66 6 54Z")] },
  { id: "destello", category: "decorativos", name: "Destello", elements: [solid(starPath(4, 46, 9))] },
  {
    id: "destellos",
    category: "decorativos",
    name: "Tres destellos",
    elements: [solid(starPath(4, 30, 6, 32, 62)), solid(starPath(4, 24, 5, 74, 28)), solid(starPath(4, 16, 4, 76, 78), "ink")],
  },
  { id: "puntos-fila", category: "decorativos", name: "Fila de puntos", elements: [14, 32, 50, 68, 86].map((cx) => dot(cx, 50, 6, "primary")) },
  { id: "circulo-garabato", category: "decorativos", name: "Círculo a mano", elements: [stroke("M50 12C78 10 94 34 88 58C82 82 52 92 30 80C8 68 8 34 32 20C52 8 78 14 84 30", "ink", 5)] },
  { id: "corchetes", category: "decorativos", name: "Corchetes", elements: [stroke("M34 14H18V86H34M66 14H82V86H66", "ink", 7)] },
  { id: "comillas", category: "decorativos", name: "Comillas", elements: [{ type: "text", x: 50, y: 86, text: "“", size: 120, fill: "primary" }] },
  { id: "asterisco", category: "decorativos", name: "Asterisco", elements: [stroke("M50 10V90M16 30L84 70M16 70L84 30", "primary", 10)] },
  {
    id: "sol",
    category: "decorativos",
    name: "Sol",
    elements: [dot(50, 50, 17, "primary"), stroke("M50 8V22M50 78V92M8 50H22M78 50H92M20 20L30 30M70 70L80 80M80 20L70 30M30 70L20 80", "primary", 7)],
  },
  {
    id: "flor",
    category: "decorativos",
    name: "Flor",
    elements: [
      ...[0, 1, 2, 3, 4, 5].map((index) => {
        const angle = (Math.PI * 2 * index) / 6 - Math.PI / 2;
        return dot(Number(r1(50 + 26 * Math.cos(angle))), Number(r1(50 + 26 * Math.sin(angle))), 15, "primary");
      }),
      dot(50, 50, 13, "surface"),
    ],
  },

  // ---- sellos y textos -----------------------------------------------------------------------------------------
  seal("sello-nuevo", "Sello «Nuevo»", ["NUEVO"], 17, 60),
  seal("sello-oferta", "Sello «Oferta»", ["OFERTA"], 16, 62),
  seal("sello-gratis", "Sello «Gratis»", ["GRATIS"], 16, 62),
  seal("sello-disponible", "Sello «Disponible»", ["DISPONIBLE"], 11, 64),
  seal("sello-top", "Sello «Top»", ["TOP"], 24, 46),
  seal("sello-recomendado", "Sello «Recomendado»", ["RECOMENDADO"], 9.5, 66),
  seal("sello-hecho-a-mano", "Sello «Hecho a mano»", ["HECHO A", "MANO"], 14, 56),
  seal("sello-edicion-limitada", "Sello «Edición limitada»", ["EDICIÓN", "LIMITADA"], 12, 60),
  seal("sello-descuento", "Sello «-20 %»", ["-20%"], 22, 54),
  seal("sello-reservas", "Sello «Reservas abiertas»", ["RESERVAS", "ABIERTAS"], 11, 62),
  {
    id: "sello-agotado",
    category: "sellos",
    name: "Sello «Agotado»",
    elements: [
      { type: "circle", cx: 50, cy: 50, r: 41, stroke: "ink", strokeWidth: 5, fill: "none" },
      { type: "circle", cx: 50, cy: 50, r: 33, stroke: "ink", strokeWidth: 2, fill: "none" },
      { type: "text", x: 50, y: 56, text: "AGOTADO", size: 14, fill: "ink", fit: 56 },
    ],
  },
  {
    id: "cinta-proximamente",
    category: "sellos",
    name: "Cinta «Próximamente»",
    elements: [solid("M4 30H96V70H4L16 50Z"), label(52, 56, "PRÓXIMAMENTE", 11, 64)],
  },
];

export const STICKER_IDS: readonly string[] = STICKER_CATALOG.map((sticker) => sticker.id);
const BY_ID = new Map(STICKER_CATALOG.map((sticker) => [sticker.id, sticker]));

export function getSticker(id: string): StickerDefinition | undefined {
  return BY_ID.get(id);
}

export function isStickerId(id: string): boolean {
  return BY_ID.has(id);
}
