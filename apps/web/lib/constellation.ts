// Modelo de la "constelación de enlaces" del hero comercial (ADR-009): un centro (tu enlace) con
// nodos alrededor (formularios, CRM, QR, analítica…) unidos entre sí y al centro, polvo de fondo y
// pulsos que viajan por las conexiones. Todo acá es puro y determinista (misma semilla, misma
// figura): el componente `HeroScene` solo lo dibuja con three.js. Nunca se usa en sitios de tenants.

export type SceneMode = "off" | "static" | "animated";
export type SceneTier = "low" | "high";

export interface DeviceHints {
  webgl: boolean;
  reducedMotion: boolean;
  saveData: boolean;
  viewportWidth: number;
  /** `navigator.hardwareConcurrency`; no existe en todos los navegadores. */
  cores?: number;
  /** `navigator.deviceMemory` en GB; solo Chromium lo expone. */
  memoryGb?: number;
}

export interface SceneQuality {
  mode: SceneMode;
  tier: SceneTier;
}

export interface SceneBudget {
  dust: number;
  nodes: number;
  pulses: number;
  /** Vecinos más cercanos con los que se une cada nodo (además del centro). */
  neighbors: number;
  maxPixelRatio: number;
  antialias: boolean;
}

export const SCENE_BUDGETS: Record<SceneTier, SceneBudget> = {
  low: { dust: 260, nodes: 14, pulses: 8, neighbors: 2, maxPixelRatio: 1.5, antialias: false },
  high: { dust: 720, nodes: 26, pulses: 20, neighbors: 3, maxPixelRatio: 2, antialias: true },
};

/** Ancho desde el que se considera escritorio (el `md` de Tailwind). */
export const DESKTOP_MIN_WIDTH = 768;

/**
 * Qué escena conviene según el dispositivo. Sin WebGL o con ahorro de datos no hay escena (queda el
 * fondo CSS); con movimiento reducido se pinta un cuadro fijo; teléfonos y equipos modestos van con
 * la versión liviana.
 */
export function chooseSceneQuality(hints: DeviceHints): SceneQuality {
  const modest =
    hints.viewportWidth < DESKTOP_MIN_WIDTH ||
    (hints.cores !== undefined && hints.cores <= 4) ||
    (hints.memoryGb !== undefined && hints.memoryGb <= 4);
  const tier: SceneTier = modest ? "low" : "high";
  if (!hints.webgl || hints.saveData) {
    return { mode: "off", tier };
  }
  return { mode: hints.reducedMotion ? "static" : "animated", tier };
}

/** Generador pseudoaleatorio con semilla (mulberry32): la figura es la misma en cada visita. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` puntos repartidos parejo sobre una esfera (espiral de Fibonacci), como `[x, y, z, …]`.
 * `jitter` (0–1) los aleja o acerca del radio para que el polvo no se vea como una cáscara perfecta.
 */
export function fibonacciSphere(count: number, radius: number, rng: () => number, jitter = 0): Float32Array {
  const points = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let index = 0; index < count; index += 1) {
    const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    const r = radius * (1 + (rng() * 2 - 1) * jitter);
    points[index * 3] = Math.cos(theta) * ring * r;
    points[index * 3 + 1] = y * r;
    points[index * 3 + 2] = Math.sin(theta) * ring * r;
  }
  return points;
}

export interface ConstellationNode {
  x: number;
  y: number;
  z: number;
  /** Radio de la esfera del nodo. */
  size: number;
}

/**
 * Nodos en una cáscara entre `minRadius` y `maxRadius`, repartidos con Fibonacci (para que no se
 * amontonen) y un poco de azar en radio y tamaño. El índice 0 NO es el centro: el centro se dibuja
 * aparte, en el origen.
 */
export function createNodes(count: number, rng: () => number, minRadius: number, maxRadius: number): ConstellationNode[] {
  const directions = fibonacciSphere(count, 1, rng);
  const nodes: ConstellationNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const radius = minRadius + rng() * (maxRadius - minRadius);
    nodes.push({
      x: directions[index * 3]! * radius,
      y: directions[index * 3 + 1]! * radius * 0.8,
      z: directions[index * 3 + 2]! * radius,
      size: 0.07 + rng() * 0.09,
    });
  }
  return nodes;
}

/** Arista no dirigida entre dos nodos; `-1` es el centro. Siempre `a < b`. */
export type Edge = readonly [a: number, b: number];

export const HUB = -1;

function distanceSquared(a: ConstellationNode, b: ConstellationNode): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

/**
 * Cada nodo se une al centro y a sus `neighbors` vecinos más cercanos. Sin aristas repetidas ni
 * lazos; orden estable (primero las del centro, luego por índice).
 */
export function connectConstellation(nodes: readonly ConstellationNode[], neighbors: number): Edge[] {
  const edges: Edge[] = nodes.map((_, index) => [HUB, index] as const);
  const seen = new Set<string>();
  for (let index = 0; index < nodes.length; index += 1) {
    const nearest = nodes
      .map((other, otherIndex) => ({ otherIndex, d: distanceSquared(nodes[index]!, other) }))
      .filter(({ otherIndex }) => otherIndex !== index)
      .sort((left, right) => left.d - right.d || left.otherIndex - right.otherIndex)
      .slice(0, neighbors);
    for (const { otherIndex } of nearest) {
      const a = Math.min(index, otherIndex);
      const b = Math.max(index, otherIndex);
      const key = `${a}:${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([a, b]);
      }
    }
  }
  return edges;
}

export const PULSE_SECONDS = 2.6;

/**
 * Dónde va el pulso `index` en el segundo `time`: por qué arista y cuánto avanzó (0 ≤ progreso < 1).
 * Cada pulso arranca desfasado y, al terminar una vuelta, salta a otra arista — determinista, sin
 * estado entre cuadros.
 */
export function pulseAt(index: number, time: number, edgeCount: number): { edge: number; progress: number } {
  if (edgeCount <= 0) {
    return { edge: 0, progress: 0 };
  }
  const shifted = Math.max(0, time) / PULSE_SECONDS + index * 0.37;
  const cycle = Math.floor(shifted);
  const progress = shifted - cycle;
  const edge = (index * 7919 + cycle * 104729) % edgeCount;
  return { edge, progress };
}

/** Acerca `current` a `target` de forma exponencial e independiente de los FPS. */
export function damp(current: number, target: number, lambda: number, deltaSeconds: number): number {
  return target + (current - target) * Math.exp(-lambda * Math.max(0, deltaSeconds));
}

/** Suavizado 0→1→0 del brillo de un pulso a lo largo de la arista (aparece y se apaga). */
export function pulseIntensity(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return Math.sin(clamped * Math.PI);
}
