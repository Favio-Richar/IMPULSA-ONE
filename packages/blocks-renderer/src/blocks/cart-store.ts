import { useSyncExternalStore } from "react";
import { cartLineSchema, MAX_CART_LINES, MAX_ORDER_QUANTITY, type CartLine } from "@impulza/validation";

// Carrito del visitante (F7.8c, ADR-023): uno por sitio, en el navegador, con solo ids y cantidades
// (nunca precios ni datos personales). Si el almacenamiento no está disponible (navegación privada,
// bloqueado), el carrito vive en memoria mientras dure la página. Lo leído se valida con el mismo
// esquema que la API: un valor manipulado o viejo se descarta, no rompe la página.

const EMPTY: readonly CartLine[] = Object.freeze([]);
const cache = new Map<string, readonly CartLine[]>();
const listeners = new Map<string, Set<() => void>>();

function storageKey(siteSlug: string): string {
  return `impulza-cart:${siteSlug}`;
}

function sameLine(a: Pick<CartLine, "productId" | "variantId">, b: Pick<CartLine, "productId" | "variantId">): boolean {
  return a.productId === b.productId && (a.variantId ?? null) === (b.variantId ?? null);
}

/** Lee y valida lo guardado; descarta líneas inválidas o repetidas. */
export function parseStoredCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const lines: CartLine[] = [];
  for (const item of value) {
    const parsed = cartLineSchema.safeParse(item);
    if (parsed.success && !lines.some((line) => sameLine(line, parsed.data)) && lines.length < MAX_CART_LINES) {
      lines.push(parsed.data);
    }
  }
  return lines;
}

function read(siteSlug: string): readonly CartLine[] {
  const cached = cache.get(siteSlug);
  if (cached) return cached;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey(siteSlug));
  } catch {
    raw = null;
  }
  const lines = Object.freeze(parseStoredCart(raw));
  cache.set(siteSlug, lines);
  return lines;
}

function write(siteSlug: string, lines: CartLine[]): void {
  cache.set(siteSlug, Object.freeze(lines));
  try {
    if (lines.length === 0) window.localStorage.removeItem(storageKey(siteSlug));
    else window.localStorage.setItem(storageKey(siteSlug), JSON.stringify(lines));
  } catch {
    // Sin almacenamiento: el carrito sigue en memoria.
  }
  for (const listener of listeners.get(siteSlug) ?? []) listener();
}

function subscribe(siteSlug: string, listener: () => void): () => void {
  const set = listeners.get(siteSlug) ?? new Set();
  set.add(listener);
  listeners.set(siteSlug, set);
  // Otra pestaña del mismo sitio cambió el carrito.
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey(siteSlug)) {
      cache.delete(siteSlug);
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    set.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useCart(siteSlug: string): readonly CartLine[] {
  return useSyncExternalStore(
    (listener) => subscribe(siteSlug, listener),
    () => read(siteSlug),
    () => EMPTY,
  );
}

export type AddResult = "added" | "full";

/** Agrega (o suma a la misma línea, sin pasar el tope de unidades). */
export function addToCart(siteSlug: string, line: CartLine, maxQuantity: number = MAX_ORDER_QUANTITY): AddResult {
  const lines = [...read(siteSlug)];
  const index = lines.findIndex((existing) => sameLine(existing, line));
  const cap = Math.max(1, Math.min(maxQuantity, MAX_ORDER_QUANTITY));
  if (index >= 0) {
    lines[index] = { ...lines[index]!, quantity: Math.min(cap, lines[index]!.quantity + line.quantity) };
  } else {
    if (lines.length >= MAX_CART_LINES) return "full";
    lines.push({ ...line, quantity: Math.min(cap, line.quantity) });
  }
  write(siteSlug, lines);
  return "added";
}

export function setCartQuantity(siteSlug: string, line: Pick<CartLine, "productId" | "variantId">, quantity: number): void {
  write(
    siteSlug,
    read(siteSlug).map((existing) => (sameLine(existing, line) ? { ...existing, quantity: Math.max(1, Math.min(MAX_ORDER_QUANTITY, quantity)) } : existing)),
  );
}

export function removeFromCart(siteSlug: string, line: Pick<CartLine, "productId" | "variantId">): void {
  write(
    siteSlug,
    read(siteSlug).filter((existing) => !sameLine(existing, line)),
  );
}

export function clearCart(siteSlug: string): void {
  write(siteSlug, []);
}

// --- Un solo carrito visible por página ---
// Varios bloques de tienda pueden compartir la página; el primero que se registra muestra la barra y
// el panel del carrito. Registro explícito (no "el primero que se pinta"): determinista y sin estados
// puestos desde un efecto.

const owners = new Map<string, string[]>();
const ownerListeners = new Set<() => void>();

export function registerCartBlock(siteSlug: string, blockId: string): () => void {
  owners.set(siteSlug, [...(owners.get(siteSlug) ?? []), blockId]);
  for (const listener of ownerListeners) listener();
  return () => {
    owners.set(
      siteSlug,
      (owners.get(siteSlug) ?? []).filter((id) => id !== blockId),
    );
    for (const listener of ownerListeners) listener();
  };
}

export function useIsCartOwner(siteSlug: string, blockId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      ownerListeners.add(listener);
      return () => ownerListeners.delete(listener);
    },
    () => owners.get(siteSlug)?.[0] === blockId,
    () => false,
  );
}

// "Ver carrito" desde cualquier producto abre el panel del bloque dueño.
const openRequests = new Map<string, Set<() => void>>();

export function onCartOpenRequest(siteSlug: string, handler: () => void): () => void {
  const set = openRequests.get(siteSlug) ?? new Set();
  set.add(handler);
  openRequests.set(siteSlug, set);
  return () => set.delete(handler);
}

export function requestOpenCart(siteSlug: string): void {
  for (const handler of openRequests.get(siteSlug) ?? []) handler();
}

/** Solo para pruebas: olvida lo leído en memoria. */
export function resetCartCacheForTests(): void {
  cache.clear();
}
